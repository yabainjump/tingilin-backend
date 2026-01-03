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

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(email: string, password: string) {
    const existing = await this.usersService.findByEmail(email);
    if (existing) throw new ConflictException('Email already in use');

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await this.usersService.createUser({
      email,
      passwordHash,
      role: 'USER',
    });

    return this.issueTokens(user._id.toString(), user.email, user.role);
  }

  async login(email: string, password: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user) throw new UnauthorizedException('Invalid credentials');

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    return this.issueTokens(user._id.toString(), user.email, user.role);
  }

  issueTokens(userId: string, email: string, role: string) {
    const payload: Record<string, any> = { sub: userId, email, role };

    const accessExpires = this.config.get<string>(
      'JWT_ACCESS_EXPIRES_IN',
      '15m',
    ) as StringValue;
    const refreshExpires = this.config.get<string>(
      'JWT_REFRESH_EXPIRES_IN',
      '7d',
    ) as StringValue;

    const access_token = this.jwtService.sign(payload, {
      secret: this.config.get<string>(
        'JWT_ACCESS_SECRET',
        'CHANGE_ME_ACCESS_SECRET',
      ),
      expiresIn: accessExpires,
    });

    const refresh_token = this.jwtService.sign(payload, {
      secret: this.config.get<string>(
        'JWT_REFRESH_SECRET',
        'CHANGE_ME_REFRESH_SECRET',
      ),
      expiresIn: refreshExpires,
    });

    return { access_token, refresh_token };
  }
}
