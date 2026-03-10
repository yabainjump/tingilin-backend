import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { Types } from 'mongoose';

export enum RaffleStatus {
  DRAFT = 'DRAFT',
  LIVE = 'LIVE',
  CLOSED = 'CLOSED',
  DRAWN = 'DRAWN',
}

export enum WinnerFulfillmentStatus {
  PENDING_VERIFICATION = 'PENDING_VERIFICATION',
  VERIFIED = 'VERIFIED',
  IN_SHIPPING = 'IN_SHIPPING',
  DELIVERED = 'DELIVERED',
}

export class RaffleWinner {
  userId!: Types.ObjectId;
  ticketId!: Types.ObjectId;
  drawnAt!: Date;
  isPublished!: boolean;
  fulfillmentStatus!: WinnerFulfillmentStatus;
  fulfillmentUpdatedAt!: Date;
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

  @Prop({ type: Number, default: 0, select: false })
  internalItemCost?: number;

  @Prop({
    type: {
      userId: { type: Types.ObjectId, ref: 'User' },
      ticketId: { type: Types.ObjectId, ref: 'Ticket' },
      drawnAt: { type: Date },
      isPublished: { type: Boolean, default: true },
      fulfillmentStatus: {
        type: String,
        enum: Object.values(WinnerFulfillmentStatus),
        default: WinnerFulfillmentStatus.PENDING_VERIFICATION,
      },
      fulfillmentUpdatedAt: { type: Date, default: () => new Date() },
    },
    default: null,
    _id: false,
  })
  winner?: RaffleWinner | null;
}

export const RaffleSchema = SchemaFactory.createForClass(Raffle);
