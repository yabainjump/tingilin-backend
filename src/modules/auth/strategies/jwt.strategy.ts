import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get<string>(
        'JWT_ACCESS_SECRET',
        'CHANGE_ME_ACCESS_SECRET',
      ),
    });
  }

  async validate(payload: any) {
    return payload; // { sub, email, role }
  }
}
