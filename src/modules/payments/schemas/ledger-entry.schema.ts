import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type LedgerEntryDocument = HydratedDocument<LedgerEntry>;
export type LedgerEntryType = 'CASH_IN' | 'REFUND';

@Schema({ timestamps: true })
export class LedgerEntry {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  transactionId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  raffleId: Types.ObjectId;

  @Prop({ type: String, required: true, enum: ['CASH_IN', 'REFUND'], index: true })
  entryType: LedgerEntryType;

  @Prop({ type: Number, required: true, min: 0 })
  amount: number;

  @Prop({ type: String, required: true, default: 'XAF' })
  currency: string;

  @Prop({ type: String, required: true, default: 'UNKNOWN' })
  provider: string;

  @Prop({ type: String, required: false, default: '' })
  providerRef?: string;
}

export const LedgerEntrySchema = SchemaFactory.createForClass(LedgerEntry);

LedgerEntrySchema.index(
  { transactionId: 1, entryType: 1 },
  { unique: true, sparse: true },
);
