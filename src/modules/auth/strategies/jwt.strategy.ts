import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../../users/users.service';
import { getRequiredSecret } from '../../../common/config/runtime-security';
import { isDatabaseAvailabilityError } from '../../../common/database/database-availability';

interface CachedUser {
  user: any;
  expiresAt: number;
}

const USER_CACHE_MAX_ENTRIES = 5_000;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  /**
   * Cache court TTL sur la relecture utilisateur a chaque requete JWT.
   * A 2000 requetes/s, cela evite 2000 lectures Mongo/seconde: une seule
   * lecture par utilisateur et par fenetre de TTL. La revocation (tokenVersion)
   * et la suspension restent appliquees avec au plus TTL_MS de latence.
   */
  private readonly cacheTtlMs = Math.max(
    0,
    Number(process.env.JWT_USER_CACHE_TTL_MS ?? 15000) || 0,
  );
  private readonly cache = new Map<string, CachedUser>();
  private readonly inFlight = new Map<string, Promise<any>>();

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
      const userId = String(payload?.sub ?? '');
      const tokenVersion = Number(payload?.ver ?? 0);
      const user = await this.loadUser(userId);
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
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      // Base indisponible ou saturee (pool epuise, timeout, reseau): ce n'est
      // PAS un token invalide. Repondre 401 ferait deconnecter l'utilisateur
      // par l'app alors que sa session est valide; 503 = "reessaie".
      if (isDatabaseAvailabilityError(error)) {
        throw new ServiceUnavailableException(
          'Service temporarily unavailable, please retry',
        );
      }
      throw new UnauthorizedException('Invalid token');
    }
  }

  private async loadUser(userId: string): Promise<any> {
    if (this.cacheTtlMs <= 0) {
      return this.usersService.findById(userId);
    }

    const cached = this.cache.get(userId);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.user;
    }
    if (cached) {
      this.cache.delete(userId);
    }

    // L'ecran d'accueil envoie ~4 requetes en parallele pour le meme
    // utilisateur: une seule lecture Mongo partagee au lieu de 4.
    const pending = this.inFlight.get(userId);
    if (pending) return pending;

    const lookup = this.usersService.findById(userId).then((user) => {
      if (this.cache.size >= USER_CACHE_MAX_ENTRIES) {
        // FIFO simple: on evite la croissance illimitee du cache en memoire.
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
      this.cache.set(userId, {
        user,
        expiresAt: Date.now() + this.cacheTtlMs,
      });
      return user;
    });
    this.inFlight.set(userId, lookup);
    try {
      return await lookup;
    } finally {
      this.inFlight.delete(userId);
    }
  }
}
