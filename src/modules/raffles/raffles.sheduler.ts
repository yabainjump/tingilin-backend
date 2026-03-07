import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RafflesService } from './raffles.service';

@Injectable()
export class RafflesScheduler {
  private running = false;

  constructor(private readonly rafflesService: RafflesService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.rafflesService.notifyEndingSoonMilestones();
      await this.rafflesService.autoCloseAndDrawExpired();
    } finally {
      this.running = false;
    }
  }
}
