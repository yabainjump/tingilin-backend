import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Request,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UsersService } from '../users/users.service';
import type { Response } from 'express';

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly usersService: UsersService,
  ) {}

  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 5 * 60_000 } })
  async register(
    @Body() dto: RegisterDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.presentTokens(await this.authService.register(dto), req, res);
  }

  @Post('login')
  @Throttle({ default: { limit: 8, ttl: 60_000 } })
  async login(
    @Body() dto: LoginDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.authService.login(dto.email, dto.password, {
      ip: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
    return this.presentTokens(tokens, req, res);
  }

  @Post('admin/login')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async adminLogin(
    @Body() dto: LoginDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.authService.login(dto.email, dto.password, {
      adminOnly: true,
      ip: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
    return this.presentTokens(tokens, req, res);
  }

  @Post('forgot-password')
  @Throttle({ default: { limit: 4, ttl: 5 * 60_000 } })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @Throttle({ default: { limit: 8, ttl: 5 * 60_000 } })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @ApiBearerAuth('access-token')
  @UseGuards(AuthGuard('jwt'))
  @Get('me')
  async me(@Request() req: any) {
    const user = await this.usersService.findById(req.user?.sub);
    return this.usersService.toPublic(user);
  }

  @Post('refresh')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async refresh(
    @Body() dto: RefreshTokenDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken =
      String(dto.refresh_token ?? '').trim() ||
      this.readCookie(req, this.refreshCookieName());
    const tokens = await this.authService.refresh(refreshToken);
    return this.presentTokens(tokens, req, res);
  }

  @Post('logout')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  async logout(
    @Body() dto: RefreshTokenDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken =
      String(dto.refresh_token ?? '').trim() ||
      this.readCookie(req, this.refreshCookieName());
    const result = refreshToken
      ? await this.authService.logoutWithRefreshToken(refreshToken)
      : { ok: true };
    res.clearCookie(this.refreshCookieName(), this.refreshCookieOptions(false));
    return result;
  }

  private presentTokens(
    tokens: { access_token: string; refresh_token: string },
    req: any,
    res: Response,
  ) {
    res.cookie(
      this.refreshCookieName(),
      tokens.refresh_token,
      this.refreshCookieOptions(),
    );
    const isNative =
      String(req?.headers?.['x-client-platform'] ?? '').toLowerCase() ===
      'native';
    return isNative ? tokens : { access_token: tokens.access_token };
  }

  private refreshCookieName(): string {
    return 'tingilin_refresh';
  }

  private refreshCookieOptions(includeMaxAge = true) {
    const prefix = String(process.env.API_PREFIX ?? 'api/v1').replace(/^\/+|\/+$/g, '');
    return {
      httpOnly: true,
      secure: String(process.env.NODE_ENV ?? '').toLowerCase() === 'production',
      sameSite: 'strict' as const,
      path: `/${prefix}/auth`,
      ...(includeMaxAge ? { maxAge: 7 * 24 * 60 * 60 * 1000 } : {}),
    };
  }

  private readCookie(req: any, name: string): string {
    const raw = String(req?.headers?.cookie ?? '');
    for (const part of raw.split(';')) {
      const [key, ...value] = part.trim().split('=');
      if (key === name) {
        try {
          return decodeURIComponent(value.join('='));
        } catch {
          return '';
        }
      }
    }
    return '';
  }
}
