import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../../users/users.service';
import { getRequiredSecret } from '../../../common/config/runtime-security';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: getRequiredSecret(config, 'JWT_ACCESS_SECRET', {
        minLength: 32,
      }),
    });
  }

  async validate(payload: any) {
    try {
      const user = await this.usersService.findById(String(payload?.sub ?? ''));
      const tokenVersion = Number(payload?.ver ?? 0);
      const currentVersion = Number((user as any)?.tokenVersion ?? 0);

      if (tokenVersion !== currentVersion) {
        throw new UnauthorizedException('Session revoked');
      }

      if (String(user.status ?? 'ACTIVE').toUpperCase() !== 'ACTIVE') {
        throw new UnauthorizedException('Account suspended');
      }
      return {
        sub: user._id.toString(),
        email: user.email,
        role: user.role,
        status: user.status,
      };
    } catch {
      throw new UnauthorizedException('Invalid token');
    }
  }
}
