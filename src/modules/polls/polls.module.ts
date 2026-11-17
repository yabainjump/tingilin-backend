import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditModule } from '../audit/audit.module';
import { PollsController } from './polls.controller';
import { PollsAdminController } from './polls.admin.controller';
import { PollsService } from './polls.service';
import {
  Poll,
  PollSchema,
  PollVote,
  PollVoteSchema,
} from './schemas/poll.schema';

@Module({
  imports: [
    AuditModule,
    MongooseModule.forFeature([
      { name: Poll.name, schema: PollSchema },
      { name: PollVote.name, schema: PollVoteSchema },
    ]),
  ],
  controllers: [PollsController, PollsAdminController],
  providers: [PollsService],
})
export class PollsModule {}
