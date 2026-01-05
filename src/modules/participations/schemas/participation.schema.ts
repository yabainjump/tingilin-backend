import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ParticipationDocument = HydratedDocument<Participation>;

@Schema({ timestamps: true })
export class Participation {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  raffleId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: Date, default: () => new Date() })
  firstPurchaseAt: Date;

  @Prop({ type: Number, default: 0 })
  totalTicketsBought: number;

  @Prop({ type: Number, default: 0 })
  failedAttempts: number;

  @Prop({ type: Date })
  blockedUntil?: Date;
}

export const ParticipationSchema = SchemaFactory.createForClass(Participation);
ParticipationSchema.index({ raffleId: 1, userId: 1 }, { unique: true });
