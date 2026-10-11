import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ParticipationsController } from './participations.controller';
import { ParticipationsService } from './participations.service';
import {
  Participation,
  ParticipationSchema,
} from './schemas/participation.schema';
import { Ticket, TicketSchema } from '../tickets/schemas/ticket.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Participation.name, schema: ParticipationSchema },
      { name: Ticket.name, schema: TicketSchema },
    ]),
  ],
  controllers: [ParticipationsController],
  providers: [ParticipationsService],
  exports: [ParticipationsService],
})
export class ParticipationsModule {}
