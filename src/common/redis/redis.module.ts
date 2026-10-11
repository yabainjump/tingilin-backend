import { Global, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

/**
 * Fournit un client Redis OPTIONNEL (token = null si REDIS_URL est absent).
 * Toute la plateforme doit rester fonctionnelle sans Redis (mode 1 instance)
 * et scaler automatiquement quand REDIS_URL est configure.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Redis | null => {
        const url = String(config.get<string>('REDIS_URL') ?? '').trim();
        if (!url) return null;

        const logger = new Logger('Redis');
        const client = new Redis(url, {
          maxRetriesPerRequest: null,
          enableOfflineQueue: false,
          connectTimeout: 5_000,
          retryStrategy: (times) => Math.min(times * 500, 5_000),
        });

        client.on('error', (error) => {
          logger.error(`Redis error: ${error?.message ?? String(error)}`);
        });
        client.on('connect', () => logger.log('Redis connected'));
        client.on('end', () => logger.warn('Redis connection closed'));

        return client;
      },
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnApplicationShutdown {
  onApplicationShutdown() {
    // Les clients sont fermes par le processus a l'arret; ioredis se deconnecte
    // automatiquement a la destruction du process. Rien d'obligatoire ici.
  }
}
