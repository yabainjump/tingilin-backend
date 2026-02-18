import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../users/users.service';
import type { StringValue } from 'ms';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const email = dto.email.toLowerCase();

    const existing = await this.usersService.findByEmail(email);
    if (existing) throw new ConflictException('Email already in use');

    const passwordHash = await this.hashPassword(dto.password);

    const user = await this.usersService.createUser({
      email,
      passwordHash,
      firstName: dto.firstName,
      lastName: dto.lastName,
      phone: dto.phone,
    });

    return this.signToken(user);
  }

  private async hashPassword(password: string): Promise<string> {
    const saltRounds = 10;
    return bcrypt.hash(password, saltRounds);
  }

  private async signToken(user: any): Promise<{ access_token: string }> {
    const payload = {
      sub: user.id ?? user._id?.toString(),
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      avatar: user.avatar,
    };

    return {
      access_token: await this.jwtService.signAsync(payload),
    };
  }

  async login(email: string, password: string) {
    const user = await this.usersService.findByEmail(email.toLowerCase());
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    return this.issueTokens(user); // ✅ passe l'user complet
  }

  issueTokens(user: any) {
    // ✅ Access token = infos UI (nom/prénom/phone/avatar)
    const accessPayload: Record<string, any> = {
      sub: user._id.toString(),
      email: user.email,
      role: user.role,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      avatar: user.avatar,
    };

    // ✅ Refresh token = payload minimal (bonne pratique)
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

      return this.signToken(user);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
  }
}
