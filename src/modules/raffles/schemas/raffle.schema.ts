import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { Types } from 'mongoose';

export enum RaffleStatus {
  DRAFT = 'DRAFT',
  LIVE = 'LIVE',
  CLOSED = 'CLOSED',
  DRAWN = 'DRAWN',
}

export type RaffleDocument = HydratedDocument<Raffle>;

@Schema({ timestamps: true })
export class Raffle {
  @Prop({ type: Types.ObjectId, ref: 'Product', required: true })
  productId: Types.ObjectId;

  @Prop({ required: true, min: 0 })
  ticketPrice: number;

  @Prop({ default: 'XAF' })
  currency: string;

  @Prop({ default: 0 })
  totalTickets: number;

  @Prop({ default: 0 })
  ticketsSold: number;

  @Prop({ default: 0 })
  participantsCount: number;

  @Prop({ type: Date })
  startAt: Date;

  @Prop({ type: Date })
  endAt: Date;

  @Prop({ default: '' })
  rules: string;

  @Prop({ enum: RaffleStatus, default: RaffleStatus.DRAFT })
  status: RaffleStatus;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Ticket', default: null })
  winnerTicketId: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  winnerUserId: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  drawnAt: Date | null;

  @Prop({ default: '' })
  badge: string;
}

export const RaffleSchema = SchemaFactory.createForClass(Raffle);
