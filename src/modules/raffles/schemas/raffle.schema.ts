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

export class ProvablyFairProof {
  algorithm!: string;
  ticketCount!: number;
  ticketsetHash!: string;
  winningIndex!: number;
  digest!: string;
  committedBeforeDraw!: boolean;
  revealedAt?: Date | null;
  // Liste ORDONNEE exacte des serials au moment du tirage (fige l'ensemble des
  // participants pour une verification reproductible, insensible aux changements
  // de statut ulterieurs comme un VOID/remboursement).
  serials?: string[];
}

// Preuve de remise du lot (photo + temoignage), publiee UNIQUEMENT avec
// l'accord du gagnant (consentAt = date a laquelle l'admin l'a confirme).
export class WinnerDeliveryProof {
  imageUrl!: string;
  testimonial?: string;
  consentAt!: Date;
  publishedAt!: Date;
  publishedBy?: Types.ObjectId | null;
}

export class WinnerClaim {
  codeHash!: string;
  codeEnc!: string;
  issuedAt!: Date;
  claimedAt?: Date | null;
  claimedBy?: Types.ObjectId | null;
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

  @Prop({
    type: {
      imageUrl: { type: String, required: true },
      testimonial: { type: String, default: '' },
      consentAt: { type: Date, required: true },
      publishedAt: { type: Date, required: true },
      publishedBy: { type: Types.ObjectId, ref: 'User', default: null },
    },
    default: null,
    _id: false,
  })
  deliveryProof?: WinnerDeliveryProof | null;

  // Code de retrait a 6 chiffres remis au gagnant (email + app) et saisi par
  // un admin a la remise du lot. Jamais renvoye par l'API publique/admin:
  // codeHash (HMAC) sert a la recherche, codeEnc (AES-GCM) a le reafficher
  // au seul gagnant. Usage unique (claimedAt).
  @Prop({
    type: {
      codeHash: { type: String, required: true },
      codeEnc: { type: String, required: true },
      issuedAt: { type: Date, required: true },
      claimedAt: { type: Date, default: null },
      claimedBy: { type: Types.ObjectId, ref: 'User', default: null },
    },
    default: null,
    _id: false,
    select: false,
  })
  winnerClaim?: WinnerClaim | null;

  // Tirage verifiable (commit-reveal). Le seed est secret jusqu'au tirage,
  // puis revele via l'endpoint public de verification.
  @Prop({ type: String, select: false, default: null })
  drawServerSeed?: string | null;

  // Engagement public = SHA256(drawServerSeed), publie des la creation.
  @Prop({ type: String, default: null })
  drawCommitment?: string | null;

  @Prop({
    type: {
      algorithm: { type: String },
      ticketCount: { type: Number },
      ticketsetHash: { type: String },
      winningIndex: { type: Number },
      digest: { type: String },
      committedBeforeDraw: { type: Boolean, default: false },
      revealedAt: { type: Date, default: null },
      serials: { type: [String], default: undefined },
    },
    default: null,
    _id: false,
  })
  provablyFair?: ProvablyFairProof | null;
}

export const RaffleSchema = SchemaFactory.createForClass(Raffle);

// Index des parcours critiques (home feed, live, tirage, gagnants).
RaffleSchema.index({ status: 1, endAt: 1, createdAt: -1 });
RaffleSchema.index({ status: 1, createdAt: -1 });
RaffleSchema.index({ productId: 1, status: 1 });
RaffleSchema.index({
  status: 1,
  'winner.isPublished': 1,
  'winner.drawnAt': -1,
});
RaffleSchema.index({ winnerTicketId: 1 });
RaffleSchema.index({ 'winnerClaim.codeHash': 1 }, { sparse: true });
