import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type RaffleDocument = HydratedDocument<Raffle>;
export type RaffleStatus = 'DRAFT' | 'LIVE' | 'CLOSED' | 'DRAWN';

@Schema({ timestamps: true })
export class Raffle {
  @Prop({ type: Types.ObjectId, required: true })
  productId: Types.ObjectId;

  @Prop({ required: true, min: 0 })
  ticketPrice: number;

  @Prop({ type: String, default: 'XAF' })
  currency: string;

  @Prop({ type: Date, required: true })
  startAt: Date;

  @Prop({ type: Date, required: true })
  endAt: Date;

  @Prop({ type: String, default: 'DRAFT' })
  status: RaffleStatus;

  @Prop({ type: String, default: '' })
  rules: string;

  // stats dénormalisées (on les mettra à jour quand on fera tickets)
  @Prop({ type: Number, default: 0 })
  ticketsSold: number;

  @Prop({ type: Number, default: 0 })
  participantsCount: number;

  @Prop({ type: Types.ObjectId, required: true })
  createdBy: Types.ObjectId;
}

export const RaffleSchema = SchemaFactory.createForClass(Raffle);
