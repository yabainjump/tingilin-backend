import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type TransactionDocument = HydratedDocument<Transaction>;
export type TxStatus = 'PENDING' | 'SUCCESS' | 'FAILED' | 'REFUNDED';

@Schema({ timestamps: true })
export class Transaction {
  createdAt?: Date;

  updatedAt?: Date;

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
  providerRef?: string;

  @Prop({ type: String, required: false, default: undefined })
  idempotencyKey?: string;

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

  @Prop({
    type: String,
    enum: ['DIRECT_CHARGE', 'HOSTED_CHECKOUT'],
    required: false,
    default: undefined,
  })
  paymentFlow?: 'DIRECT_CHARGE' | 'HOSTED_CHECKOUT';

  @Prop({ type: Date, required: false })
  expiresAt?: Date;

  @Prop({
    type: String,
    enum: ['ORANGE', 'MTN'],
    required: false,
    default: undefined,
  })
  paymentMethodCode?: 'ORANGE' | 'MTN';

  @Prop({ type: Number, required: false })
  paymentWithTaxes?: number;

  @Prop({ type: String, required: false, default: undefined })
  rawProviderStatus?: string;

  /**
   * Reservation du stock de tickets sur la tombola, faite HORS transaction
   * par un seul $inc atomique (le document tombola est le point chaud: le
   * modifier dans chaque transaction provoquait des WriteConflict en cascade).
   * CLAIMING = un finaliseur est en train de reserver, RESERVED = stock pris.
   */
  @Prop({
    type: String,
    enum: ['CLAIMING', 'RESERVED'],
    required: false,
    default: undefined,
  })
  stockState?: 'CLAIMING' | 'RESERVED';

  @Prop({ type: Date, required: false, default: undefined })
  stockClaimedAt?: Date;
}

export const TransactionSchema = SchemaFactory.createForClass(Transaction);
TransactionSchema.index(
  { provider: 1, providerTransactionId: 1 },
  {
    unique: true,
    partialFilterExpression: { providerTransactionId: { $type: 'string' } },
  },
);
TransactionSchema.index(
  { provider: 1, providerRef: 1 },
  {
    partialFilterExpression: { providerRef: { $type: 'string' } },
  },
);
TransactionSchema.index(
  { userId: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: 'string' } },
  },
);
// Analytics / dashboards / liste admin: eviter les full scans des collections.
TransactionSchema.index({ status: 1, createdAt: -1 });
TransactionSchema.index({ createdAt: -1 });
TransactionSchema.index({ userId: 1, createdAt: -1 });
TransactionSchema.index({ raffleId: 1, status: 1 });
TransactionSchema.index({ status: 1, expiresAt: 1 });
