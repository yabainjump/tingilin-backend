import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import * as nodemailer from 'nodemailer';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import type { StringValue } from 'ms';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { InviteUserDto } from './dto/invite-user.dto';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly auditService: AuditService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase();

    const existing = await this.usersService.findByEmail(email);
    if (existing) throw new ConflictException('Email already in use');

    let referredBy: string | null = null;
    const referralCode = String(dto.referralCode ?? '')
      .trim()
      .toUpperCase();
    if (referralCode) {
      const inviter = await this.usersService.findByReferralCode(referralCode);
      if (!inviter) throw new BadRequestException('Invalid referral code');
      if (inviter.email?.toLowerCase() === email) {
        throw new BadRequestException('You cannot use your own referral code');
      }
      referredBy = inviter._id.toString();
    }

    const passwordHash = await this.hashPassword(dto.password);

    const bootstrapFirstAdmin =
      String(this.config.get<string>('AUTH_BOOTSTRAP_FIRST_ADMIN', 'false'))
        .trim()
        .toLowerCase() === 'true';

    let roleForNewUser: 'ADMIN' | undefined;
    if (bootstrapFirstAdmin) {
      const usersCount = await this.usersService.countUsers();
      if (usersCount === 0) {
        roleForNewUser = 'ADMIN';
      }
    }

    const user = await this.usersService.createUser({
      email,
      passwordHash,
      firstName: dto.firstName,
      lastName: dto.lastName,
      phone: dto.phone,
      referredBy,
      role: roleForNewUser,
    });

    return this.issueTokens(user);
  }

  async adminInviteUser(dto: InviteUserDto) {
    const email = String(dto.email ?? '').trim().toLowerCase();
    const phone = String(dto.phone ?? '').replace(/\s|-/g, '').trim();

    const [existingEmail, existingPhone] = await Promise.all([
      this.usersService.findByEmail(email),
      this.usersService.findByPhone(phone),
    ]);

    if (existingEmail) {
      throw new ConflictException('Email already in use');
    }

    if (existingPhone) {
      throw new ConflictException('Phone already in use');
    }

    const temporaryPassword = this.generateTemporaryPassword();
    const passwordHash = await this.hashPassword(temporaryPassword);

    const user = await this.usersService.createUser({
      email,
      passwordHash,
      firstName: dto.firstName,
      lastName: dto.lastName,
      phone,
      username: dto.username,
      role: dto.role ?? 'USER',
    });

    const delivery = await this.dispatchPasswordSetupCode({
      user,
      genericResponse: {
        ok: true,
        message: 'Compte créé. Un email d’invitation a été envoyé.',
      },
      emailType: 'INVITE',
      enforceCooldown: false,
    });

    return {
      ok: true,
      user: {
        id: user._id.toString(),
        email: user.email,
        role: user.role,
        status: user.status,
      },
      passwordSetup: delivery,
    };
  }

  private async hashPassword(password: string): Promise<string> {
    const saltRounds = 10;
    return bcrypt.hash(password, saltRounds);
  }

  async login(
    email: string,
    password: string,
    opts?: {
      adminOnly?: boolean;
      ip?: string;
      userAgent?: string;
    },
  ) {
    const normalizedEmail = String(email ?? '').trim().toLowerCase();
    const user = await this.usersService.findByEmail(normalizedEmail);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const ip = String(opts?.ip ?? '').trim();
    const userAgent = String(opts?.userAgent ?? '').trim();

    if (String(user.status ?? 'ACTIVE').toUpperCase() !== 'ACTIVE') {
      await this.auditService.safeLog({
        action: opts?.adminOnly ? 'AUTH_ADMIN_LOGIN' : 'AUTH_LOGIN',
        actorUserId: user._id.toString(),
        actorEmail: user.email,
        actorRole: user.role,
        targetType: 'USER',
        targetId: user._id.toString(),
        status: 'FAILED',
        metadata: { reason: 'ACCOUNT_SUSPENDED' },
        ip,
        userAgent,
      });
      throw new UnauthorizedException('Account suspended');
    }

    const now = Date.now();
    const blockedUntilMs = user.loginBlockedUntil
      ? new Date(user.loginBlockedUntil).getTime()
      : 0;
    if (blockedUntilMs && blockedUntilMs > now) {
      const retryAfterSeconds = Math.ceil((blockedUntilMs - now) / 1000);
      const retryAfterMinutes = Math.ceil(retryAfterSeconds / 60);
      throw new UnauthorizedException(
        `Trop de tentatives. Reessaie dans ${retryAfterMinutes} minute(s).`,
      );
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      const maxAttempts = Math.max(
        1,
        Number(this.config.get<string>('AUTH_LOGIN_MAX_ATTEMPTS', '5')),
      );
      const lockMinutes = Math.max(
        1,
        Number(this.config.get<string>('AUTH_LOGIN_LOCK_MINUTES', '15')),
      );
      user.failedLoginAttempts = Number(user.failedLoginAttempts ?? 0) + 1;

      if (Number(user.failedLoginAttempts) >= maxAttempts) {
        user.loginBlockedUntil = new Date(now + lockMinutes * 60 * 1000);
        user.failedLoginAttempts = 0;
      }
      await user.save();

      await this.auditService.safeLog({
        action: opts?.adminOnly ? 'AUTH_ADMIN_LOGIN' : 'AUTH_LOGIN',
        actorUserId: user._id.toString(),
        actorEmail: user.email,
        actorRole: user.role,
        targetType: 'USER',
        targetId: user._id.toString(),
        status: 'FAILED',
        metadata: {
          reason: 'INVALID_CREDENTIALS',
          blockedUntil: user.loginBlockedUntil ?? null,
        },
        ip,
        userAgent,
      });
      throw new UnauthorizedException('Invalid credentials');
    }

    if (opts?.adminOnly && user.role !== 'ADMIN') {
      await this.auditService.safeLog({
        action: 'AUTH_ADMIN_LOGIN',
        actorUserId: user._id.toString(),
        actorEmail: user.email,
        actorRole: user.role,
        targetType: 'USER',
        targetId: user._id.toString(),
        status: 'FAILED',
        metadata: { reason: 'NOT_ADMIN' },
        ip,
        userAgent,
      });
      throw new UnauthorizedException('Admin access required');
    }

    user.failedLoginAttempts = 0;
    user.loginBlockedUntil = null;
    user.lastLoginAt = new Date();
    await user.save();

    await this.auditService.safeLog({
      action: opts?.adminOnly ? 'AUTH_ADMIN_LOGIN' : 'AUTH_LOGIN',
      actorUserId: user._id.toString(),
      actorEmail: user.email,
      actorRole: user.role,
      targetType: 'USER',
      targetId: user._id.toString(),
      metadata: { success: true },
      ip,
      userAgent,
    });

    return this.issueTokens(user);
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const identifier = this.extractIdentifier(dto);
    if (!identifier) {
      throw new BadRequestException('Email ou téléphone requis');
    }

    const user = await this.findUserByIdentifier(identifier);
    const genericResponse = {
      ok: true,
      message:
        'Si ce compte existe, un code de réinitialisation a été envoyé par email.',
    };

    // Anti-enumeration: do not reveal if user exists.
    if (!user) return genericResponse;
    return this.dispatchPasswordSetupCode({
      user,
      genericResponse,
      emailType: 'RESET',
      enforceCooldown: true,
    });
  }

  async resetPassword(dto: ResetPasswordDto) {
    const identifier = this.extractIdentifier(dto);
    if (!identifier) {
      throw new BadRequestException('Email ou téléphone requis');
    }

    const code = String(dto.code ?? '').replace(/\s+/g, '').trim();
    const newPassword = String(dto.newPassword ?? '');

    if (!code) {
      throw new BadRequestException('Code requis');
    }
    if (newPassword.length < 6) {
      throw new BadRequestException(
        'Le nouveau mot de passe doit contenir au moins 6 caractères',
      );
    }

    const user = await this.findUserByIdentifier(identifier);
    if (!user) {
      throw new UnauthorizedException('Code invalide ou expiré');
    }

    const expiresAt = user.passwordResetCodeExpiresAt
      ? new Date(user.passwordResetCodeExpiresAt).getTime()
      : 0;
    const maxAttempts = Math.max(
      1,
      Number(this.config.get<string>('PASSWORD_RESET_MAX_ATTEMPTS', '5')),
    );

    if (
      !user.passwordResetCodeHash ||
      !expiresAt ||
      Date.now() > expiresAt ||
      Number(user.passwordResetAttempts ?? 0) >= maxAttempts
    ) {
      throw new UnauthorizedException('Code invalide ou expiré');
    }

    const incomingHash = this.hashResetCode(code);
    if (incomingHash !== user.passwordResetCodeHash) {
      user.passwordResetAttempts = Number(user.passwordResetAttempts ?? 0) + 1;
      await user.save();
      throw new UnauthorizedException('Code invalide ou expiré');
    }

    user.passwordHash = await this.hashPassword(newPassword);
    user.passwordResetCodeHash = null;
    user.passwordResetCodeExpiresAt = null;
    user.passwordResetRequestedAt = null;
    user.passwordResetAttempts = 0;
    await user.save();

    return { ok: true, message: 'Mot de passe réinitialisé avec succès' };
  }

  issueTokens(user: any) {
   
    const accessPayload: Record<string, any> = {
      sub: user._id.toString(),
      email: user.email,
      role: user.role,
    };

    const refreshPayload: Record<string, any> = {
      sub: user._id.toString(),
      email: user.email,
      role: user.role,
    };

    const accessExpires = this.config.get<string>(
      'JWT_ACCESS_EXPIRES_IN',
      '15m',
    ) as StringValue;

    const refreshExpires = this.config.get<string>(
      'JWT_REFRESH_EXPIRES_IN',
      '7d',
    ) as StringValue;

    const access_token = this.jwtService.sign(accessPayload, {
      secret: this.config.get<string>(
        'JWT_ACCESS_SECRET',
        'CHANGE_ME_ACCESS_SECRET',
      ),
      expiresIn: accessExpires,
    });

    const refresh_token = this.jwtService.sign(refreshPayload, {
      secret: this.config.get<string>(
        'JWT_REFRESH_SECRET',
        'CHANGE_ME_REFRESH_SECRET',
      ),
      expiresIn: refreshExpires,
    });

    return { access_token, refresh_token };
  }

  async refresh(refreshToken: string) {
    if (!refreshToken) throw new UnauthorizedException('Missing refresh token');

    try {
      const payload = await this.jwtService.verifyAsync(refreshToken, {
        secret: this.config.get<string>(
          'JWT_REFRESH_SECRET',
          'CHANGE_ME_REFRESH_SECRET',
        ),
      });

      const user = await this.usersService.findById(payload.sub);
      if (!user) throw new UnauthorizedException('User not found');

      return this.issueTokens(user);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }

  private extractIdentifier(input: {
    identifier?: string;
    phoneOrEmail?: string;
    email?: string;
    phone?: string;
  }): string {
    const candidate =
      input.identifier ?? input.phoneOrEmail ?? input.email ?? input.phone;
    return String(candidate ?? '').trim();
  }

  private async findUserByIdentifier(identifier: string) {
    const value = String(identifier ?? '').trim();
    if (!value) return null;

    if (value.includes('@')) {
      return this.usersService.findByEmail(value.toLowerCase());
    }

    const byPhone = await this.usersService.findByPhone(
      value.replace(/\s|-/g, ''),
    );
    if (byPhone) return byPhone;

    return this.usersService.findByEmail(value.toLowerCase());
  }

  private async dispatchPasswordSetupCode(input: {
    user: any;
    genericResponse: { ok: boolean; message: string };
    emailType: 'RESET' | 'INVITE';
    enforceCooldown: boolean;
  }) {
    const now = Date.now();
    const resendCooldownSec = Number(
      this.config.get<string>('PASSWORD_RESET_RESEND_COOLDOWN_SEC', '60'),
    );

    if (input.enforceCooldown && input.user.passwordResetRequestedAt) {
      const elapsedMs =
        now - new Date(input.user.passwordResetRequestedAt).getTime();
      const cooldownMs = Math.max(0, resendCooldownSec) * 1000;
      if (elapsedMs < cooldownMs) {
        const retryAfterSeconds = Math.ceil((cooldownMs - elapsedMs) / 1000);
        return {
          ...input.genericResponse,
          retryAfterSeconds,
        };
      }
    }

    const ttlMinutes = Math.max(
      1,
      Number(this.config.get<string>('PASSWORD_RESET_CODE_TTL_MINUTES', '15')),
    );

    const code = this.generateResetCode();
    input.user.passwordResetCodeHash = this.hashResetCode(code);
    input.user.passwordResetCodeExpiresAt = new Date(
      now + ttlMinutes * 60 * 1000,
    );
    input.user.passwordResetRequestedAt = new Date(now);
    input.user.passwordResetAttempts = 0;
    await input.user.save();

    const delivered =
      input.emailType === 'INVITE'
        ? await this.sendInvitationPasswordSetupEmail(
            input.user.email,
            input.user.firstName,
            code,
            ttlMinutes,
          )
        : await this.sendPasswordResetEmail(
            input.user.email,
            input.user.firstName,
            code,
            ttlMinutes,
          );

    if (!delivered) {
      this.logger.warn(
        `[${input.emailType}] SMTP non configuré, code reset pour ${input.user.email}: ${code}`,
      );
    }

    const debugEnabled =
      String(this.config.get<string>('PASSWORD_RESET_DEBUG_RESPONSE', 'false'))
        .trim()
        .toLowerCase() === 'true';

    return {
      ...input.genericResponse,
      expiresInSeconds: ttlMinutes * 60,
      delivery: delivered ? 'EMAIL' : 'LOG',
      ...(debugEnabled ? { devResetCode: code } : {}),
    };
  }

  private generateResetCode(): string {
    return String(crypto.randomInt(100000, 1000000));
  }

  private generateTemporaryPassword(): string {
    return crypto.randomBytes(24).toString('base64url');
  }

  private hashResetCode(code: string): string {
    return crypto.createHash('sha256').update(code).digest('hex');
  }

  private async sendPasswordResetEmail(
    toEmail: string,
    firstName: string,
    code: string,
    ttlMinutes: number,
  ): Promise<boolean> {
    const host = String(this.config.get<string>('SMTP_HOST', '')).trim();
    const port = Number(this.config.get<string>('SMTP_PORT', '587'));
    const secure =
      String(this.config.get<string>('SMTP_SECURE', 'false'))
        .trim()
        .toLowerCase() === 'true';
    const user = String(this.config.get<string>('SMTP_USER', '')).trim();
    const pass = String(this.config.get<string>('SMTP_PASS', '')).trim();
    const from =
      String(this.config.get<string>('MAIL_FROM', '')).trim() ||
      'Tingilin <no-reply@tingilin.local>';

    if (!host || !user || !pass) return false;

    try {
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass },
      });

      const appName = String(this.config.get<string>('APP_NAME', 'Tingilin'));

      await transporter.sendMail({
        from,
        to: toEmail,
        subject: `${appName} - Code de réinitialisation`,
        text: `Bonjour ${firstName || ''}, votre code est ${code}. Il expire dans ${ttlMinutes} minutes.`,
        html: `
          <div style="font-family: Arial, sans-serif; line-height:1.5; color:#1f2937;">
            <h2 style="margin-bottom:8px;">Réinitialisation du mot de passe</h2>
            <p>Bonjour ${firstName || ''},</p>
            <p>Utilisez ce code pour réinitialiser votre mot de passe:</p>
            <p style="font-size:28px; letter-spacing:6px; font-weight:bold; margin:16px 0;">${code}</p>
            <p>Ce code expire dans <strong>${ttlMinutes} minutes</strong>.</p>
            <p>Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.</p>
          </div>
        `,
      });

      return true;
    } catch (error: any) {
      this.logger.error(
        `Envoi email reset échoué (${toEmail}): ${error?.message ?? error}`,
      );
      return false;
    }
  }

  private async sendInvitationPasswordSetupEmail(
    toEmail: string,
    firstName: string,
    code: string,
    ttlMinutes: number,
  ): Promise<boolean> {
    const host = String(this.config.get<string>('SMTP_HOST', '')).trim();
    const port = Number(this.config.get<string>('SMTP_PORT', '587'));
    const secure =
      String(this.config.get<string>('SMTP_SECURE', 'false'))
        .trim()
        .toLowerCase() === 'true';
    const user = String(this.config.get<string>('SMTP_USER', '')).trim();
    const pass = String(this.config.get<string>('SMTP_PASS', '')).trim();
    const from =
      String(this.config.get<string>('MAIL_FROM', '')).trim() ||
      'Tingilin <no-reply@tingilin.local>';

    if (!host || !user || !pass) return false;

    try {
      const transporter = nodemailer.createTransport({
        host,
        port,
        secure,
        auth: { user, pass },
      });

      const appName = String(this.config.get<string>('APP_NAME', 'Tingilin'));

      await transporter.sendMail({
        from,
        to: toEmail,
        subject: `${appName} - Invitation de compte`,
        text: `Bonjour ${firstName || ''}, votre compte a été créé. Utilisez le code ${code} pour définir votre mot de passe. Le code expire dans ${ttlMinutes} minutes.`,
        html: `
          <div style="font-family: Arial, sans-serif; line-height:1.5; color:#1f2937;">
            <h2 style="margin-bottom:8px;">Bienvenue sur ${appName}</h2>
            <p>Bonjour ${firstName || ''},</p>
            <p>Un administrateur vient de créer votre compte.</p>
            <p>Utilisez ce code pour définir votre mot de passe:</p>
            <p style="font-size:28px; letter-spacing:6px; font-weight:bold; margin:16px 0;">${code}</p>
            <p>Ce code expire dans <strong>${ttlMinutes} minutes</strong>.</p>
            <p>Si vous n'êtes pas à l'origine de cette invitation, ignorez ce message.</p>
          </div>
        `,
      });

      return true;
    } catch (error: any) {
      this.logger.error(
        `Envoi email invitation échoué (${toEmail}): ${error?.message ?? error}`,
      );
      return false;
    }
  }
}
