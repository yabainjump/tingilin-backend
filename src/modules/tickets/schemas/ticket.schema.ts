import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type TicketDocument = HydratedDocument<Ticket>;
export type TicketStatus = 'ACTIVE' | 'VOID' | 'WINNER';

@Schema({ timestamps: true })
export class Ticket {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  raffleId: Types.ObjectId;

  // @Prop({ type: Types.ObjectId, required: true, index: true })
  // userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  transactionId: Types.ObjectId;

  @Prop({ required: true })
  serial: string;

  @Prop({ type: String, default: 'ACTIVE' })
  status: TicketStatus;
}

export const TicketSchema = SchemaFactory.createForClass(Ticket);
TicketSchema.index({ raffleId: 1, serial: 1 }, { unique: true });
TicketSchema.index({ raffleId: 1, userId: 1 });
