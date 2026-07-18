import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Connection } from 'mongoose';
import { RafflesService } from './raffles.service';
import { parseBooleanFlag } from '../../common/config/runtime-security';

@Injectable()
export class RafflesScheduler {
  private readonly logger = new Logger(RafflesScheduler.name);
  private running = false;

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
