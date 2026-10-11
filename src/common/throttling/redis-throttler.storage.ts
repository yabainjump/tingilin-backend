import { Injectable, Logger } from '@nestjs/common';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type Redis from 'ioredis';

/**
 * Stockage de rate-limiting distribue base Redis.
 * Semantique proche du stockage memoire par defaut de @nestjs/throttler:
 * - compteur INCR avec TTL sur la premiere requete;
 * - blocage (blockDuration) des que le compteur depasse la limite;
 * - expire/lock partages entre toutes les instances (CGNAT friendly).
 *
 * En cas d'indisponibilite de Redis: FAIL-OPEN (on laisse passer) au lieu
 * d'une 500 sur toutes les routes.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name);
  private lastFailLogAt = 0;

  constructor(private readonly redis: Redis) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const ttlMs = Math.max(1, Math.floor(Number(ttl) || 60_000));
    const blockMs = Math.max(1, Math.floor(Number(blockDuration) || ttlMs));
    const maxLimit = Math.max(1, Math.floor(Number(limit) || 1));

    try {
      return await this.incrementViaRedis(key, ttlMs, blockMs, maxLimit);
    } catch (error) {
      // FAIL-OPEN obligatoire: si Redis est injoignable, on ne doit PAS
      // renvoyer une 500 sur toutes les routes (le guard est global, y compris
      // /health). On laisse passer la requete et on retombe en mode degrade.
      const now = Date.now();
      if (now - this.lastFailLogAt > 30_000) {
        this.lastFailLogAt = now;
        this.logger.warn(
          `Redis throttler unavailable, failing open: ${String((error as any)?.message ?? error)}`,
        );
      }
      return {
        totalHits: 1,
        timeToExpire: Math.ceil(ttlMs / 1000),
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }
  }

  private async incrementViaRedis(
    key: string,
    ttlMs: number,
    blockMs: number,
    maxLimit: number,
  ): Promise<ThrottlerStorageRecord> {
    const hits = await this.redis.incr(key);
    if (hits === 1) {
      await this.redis.pexpire(key, ttlMs);
    }

    const pttl = await this.redis.pttl(key);
    const timeToExpire =
      pttl > 0 ? Math.ceil(pttl / 1000) : Math.ceil(ttlMs / 1000);

    if (hits <= maxLimit) {
      return {
        totalHits: hits,
        timeToExpire,
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }

    const blockKey = `${key}:block`;
    const acquired = await this.redis.set(blockKey, '1', 'PX', blockMs, 'NX');
    let blockPttl = await this.redis.pttl(blockKey);
    if (blockPttl < 0) {
      await this.redis.set(blockKey, '1', 'PX', blockMs);
      blockPttl = blockMs;
    }

    if (acquired === 'OK') {
      // Nouvelle fenetre de blocage: on remet le compteur a zero (KEEPTTL)
      // pour que la reprise apres blocage redemarre a zero, comme le storage memoire.
      await this.redis.set(key, '0', 'KEEPTTL');
    }

    return {
      totalHits: hits,
      timeToExpire,
      isBlocked: true,
      timeToBlockExpire: Math.ceil(blockPttl / 1000),
    };
  }
}
