import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export const POLL_STATUSES = ['DRAFT', 'OPEN', 'CLOSED'] as const;
export type PollStatus = (typeof POLL_STATUSES)[number];

@Schema({ _id: true })
export class PollOption {
  _id!: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 80 })
  label!: string;

  // Image hebergee par l'API uniquement (/uploads/products/...).
  @Prop({ type: String, default: '' })
  imageUrl?: string;

  // Compteur denormalise; la source de verite reste la collection pollvotes.
  @Prop({ type: Number, default: 0, min: 0 })
  votes!: number;
}
export const PollOptionSchema = SchemaFactory.createForClass(PollOption);

export type PollDocument = HydratedDocument<Poll>;

/** "Choisis le prochain lot": les joueurs votent, l'admin lance la tombola gagnante. */
@Schema({ timestamps: true })
export class Poll {
  @Prop({ required: true, trim: true, maxlength: 140 })
  question!: string;

  @Prop({ type: String, default: '', trim: true, maxlength: 280 })
  description?: string;

  @Prop({ type: [PollOptionSchema], default: [] })
  options!: PollOption[];

  @Prop({ type: String, enum: POLL_STATUSES, default: 'DRAFT' })
  status!: PollStatus;

  @Prop({ type: Number, default: 0, min: 0 })
  totalVotes!: number;

  @Prop({ type: Date, default: null })
  endsAt?: Date | null;

  @Prop({ type: Date, default: null })
  openedAt?: Date | null;

  @Prop({ type: Date, default: null })
  closedAt?: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  createdAt?: Date;
  updatedAt?: Date;
}
export const PollSchema = SchemaFactory.createForClass(Poll);
PollSchema.index({ status: 1, openedAt: -1 });
PollSchema.index({ createdAt: -1 });

export type PollVoteDocument = HydratedDocument<PollVote>;

@Schema({ timestamps: true })
export class PollVote {
  @Prop({ type: Types.ObjectId, ref: 'Poll', required: true })
  pollId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, required: true })
  optionId!: Types.ObjectId;
}
export const PollVoteSchema = SchemaFactory.createForClass(PollVote);
// Un seul vote par joueur et par sondage, garanti par la base (pas par le code).
PollVoteSchema.index({ pollId: 1, userId: 1 }, { unique: true });
PollVoteSchema.index({ pollId: 1, optionId: 1 });
