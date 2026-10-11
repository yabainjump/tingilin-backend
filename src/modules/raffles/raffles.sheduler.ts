import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Connection } from 'mongoose';
import { RafflesService } from './raffles.service';
import { parseBooleanFlag } from '../../common/config/runtime-security';

const LOCK_KEY = 'raffle-scheduler';
const LOCK_STALE_MS = 110_000; // > intervalle de 60s: lock orphelin reprise auto

@Injectable()
export class RafflesScheduler {
  private readonly logger = new Logger(RafflesScheduler.name);
  private running = false;
  private lockIndexReady = false;

  constructor(
    private readonly rafflesService: RafflesService,
    @InjectConnection() private readonly mongoConnection: Connection,
    private readonly config: ConfigService,
  ) {}

  private schedulerEnabled(): boolean {
    const explicit = String(this.config.get<string>('ENABLE_RAFFLE_SCHEDULER') ?? '').trim();
    if (!explicit) return true;
    return parseBooleanFlag(explicit, true);
  }

  private isTransientMongoError(error: unknown): boolean {
    const candidate = error && typeof error === 'object'
      ? (error as Record<string, unknown>)
      : {};
    const name = typeof candidate.name === 'string' ? candidate.name : '';
    const message = error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';

    return (
      /MongoServerSelectionError|MongoNetworkError/i.test(name) ||
      /server selection|replicasetnoprimary|ssl|tls|topology|connection/i.test(message)
    );
  }

  /**
   * Verrou distribue Mongo: en multi-instance, UN SEUL processus execute le
   * cron a chaque tick (sinon notifications/tirages dupliques entre instances).
   * Le lock est repri automatiquement s'il devient orphelin (crash d'instance).
   */
  private async tryAcquireLock(): Promise<boolean> {
    try {
      const col = this.mongoConnection.collection<{
        _id: string;
        lockedAt: Date;
      }>('scheduler_locks');
      if (!this.lockIndexReady) {
        await col
          .createIndex({ lockedAt: 1 }, { expireAfterSeconds: 900 })
          .catch(() => undefined);
        this.lockIndexReady = true;
      }

      const now = new Date();
      const staleBefore = new Date(now.getTime() - LOCK_STALE_MS);
      const result: any = await col.findOneAndUpdate(
        {
          _id: LOCK_KEY,
          $or: [
            { lockedAt: { $exists: false } },
            { lockedAt: { $lt: staleBefore } },
          ],
        },
        { $set: { lockedAt: now } },
        { upsert: true, returnDocument: 'after' },
      );

      return Boolean(result && result.lockedAt);
    } catch {
      // E11000 (doc existant non stale) ou Mongo indisponible: pas le leader.
      return false;
    }
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async tick() {
    if (!this.schedulerEnabled()) return;
    if (this.running) return;
    if (Number(this.mongoConnection.readyState) !== 1) {
      this.logger.warn(
        `Skipping scheduler tick because Mongo is not ready (state ${this.mongoConnection.readyState}).`,
      );
      return;
    }

    const acquired = await this.tryAcquireLock();
    if (!acquired) return;

    this.running = true;
    try {
      await this.rafflesService.notifyEndingSoonMilestones();
      await this.rafflesService.autoCloseAndDrawExpired();
    } catch (error) {
      if (this.isTransientMongoError(error)) {
        const message =
          error instanceof Error ? error.message : String(error ?? 'Unknown MongoDB error');
        this.logger.warn(`Transient Mongo issue during scheduler tick: ${message}`);
        return;
      }

      throw error;
    } finally {
      this.running = false;
    }
  }
}
