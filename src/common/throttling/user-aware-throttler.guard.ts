import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
} from '@nestjs/throttler';
import type {
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { getRequiredSecret } from '../config/runtime-security';

/**
 * Limiteur de debit "par joueur" plutot que "par IP".
 *
 * Au Cameroun, Orange et MTN font partager une meme IP publique (CGNAT) a de
 * nombreux abonnes: compter par IP bloquait ensemble des joueurs differents
 * pendant un tirage. Une requete portant un jeton d'acces VALIDE (signature
 * verifiee, non expire) est comptee sur l'identifiant du joueur; sans jeton
 * valide (login, inscription, public) on garde l'IP.
 *
 * Le jeton est verifie ici et non simplement decode: sinon un client pourrait
 * inventer un `sub` different a chaque requete pour echapper a la limite.
 */
@Injectable()
export class UserAwareThrottlerGuard extends ThrottlerGuard {
  private readonly jwt: JwtService;

  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
    config: ConfigService,
  ) {
    super(options, storageService, reflector);
    this.jwt = new JwtService({
      secret: getRequiredSecret(config, 'JWT_ACCESS_SECRET', { minLength: 32 }),
    });
  }

  protected async getTracker(req: Record<string, any>): Promise<string> {
    const userId = this.verifiedUserId(req);
    if (userId) return `user:${userId}`;
    return `ip:${await super.getTracker(req)}`;
  }

  private verifiedUserId(req: Record<string, any>): string {
    const header = req?.headers?.authorization;
    if (typeof header !== 'string') return '';
    const match = /^Bearer\s+([A-Za-z0-9._-]{20,4096})$/.exec(header.trim());
    if (!match) return '';
    try {
      const payload = this.jwt.verify<{ sub?: unknown }>(match[1]);
      const sub = typeof payload?.sub === 'string' ? payload.sub : '';
      return /^[a-f0-9]{24}$/i.test(sub) ? sub.toLowerCase() : '';
    } catch {
      return '';
    }
  }
}
