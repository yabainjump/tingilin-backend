import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type TransactionDocument = HydratedDocument<Transaction>;
export type TxStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'REFUNDED';

@Schema({ timestamps: true })
export class Transaction {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  userId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true, index: true })
  raffleId: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 1 })
  quantity: number;

  @Prop({ type: Number, required: true, min: 0 })
  amount: number;

  @Prop({ type: String, default: 'XAF' })
  currency: string;

  @Prop({ type: String, default: 'MOCK' })
  provider: string;

  @Prop({ type: String, required: false, default: undefined })
  providerRef: string;

  @Prop({ type: String, required: false })
  failReason?: string;

  @Prop({ type: Date, required: false })
  failedAt?: Date;

  @Prop({ type: String, default: 'PENDING' })
  status: TxStatus;

  @Prop({ type: Date })
  confirmedAt?: Date;

  @Prop({ type: String, required: false, default: undefined })
  providerTransactionId?: string;

  @Prop({ type: String, required: false, default: undefined })
  paymentLink?: string;

  @Prop({ type: Number, required: false })
  paymentWithTaxes?: number;

  @Prop({ type: String, required: false, default: undefined })
  rawProviderStatus?: string;
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);
TransactionSchema.index(
  { provider: 1, providerTransactionId: 1 },
  { unique: true, sparse: true },
);
