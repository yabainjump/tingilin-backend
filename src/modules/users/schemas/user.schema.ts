import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { CAMEROON_REGIONS } from '../../../common/regions';
import { SPENDING_PERIODS, SpendingPeriod } from '../spending-limit';

export type UserDocument = HydratedDocument<User>;

export type UserRole = 'USER' | 'ADMIN' | 'MODERATOR';
export type UserStatus = 'ACTIVE' | 'SUSPENDED';
// WELCOME = bonus du filleul a son premier achat payant.
export type RewardHistorySource = 'REFERRAL' | 'LOYALTY' | 'WELCOME';

export class StoredSpendingLimit {
  period!: SpendingPeriod;
  amount!: number;
  setAt!: Date;
}

export class StoredPendingSpendingLimit {
  period?: SpendingPeriod | null;
  amount?: number | null;
  remove!: boolean;
  requestedAt!: Date;
  effectiveAt!: Date;
}

export class RewardHistoryItem {
  source!: RewardHistorySource;
  amount!: number;
  reason!: string;
  createdAt!: Date;
  metadata?: Record<string, any>;
}

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ type: String, trim: true, lowercase: true, default: '' })
  username?: string;

  @Prop({ required: true })
  passwordHash: string;

  @Prop({ type: String, default: 'USER' })
  role: UserRole;

  @Prop({ type: String, default: 'ACTIVE' })
  status: UserStatus;

  @Prop({ required: true })
  firstName!: string;

  @Prop({ required: true })
  lastName!: string;

  // Optionnel: les comptes crees via Google n'ont pas encore de telephone.
  // L'unicite est sparse (index schema ci-dessous) pour autoriser plusieurs
  // comptes sans telephone.
  @Prop({ type: String, default: null })
  phone?: string | null;

  @Prop({ unique: true, sparse: true, uppercase: true, trim: true })
  referralCode!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  referredBy?: Types.ObjectId | null;

  @Prop({ type: Boolean, default: false })
  referralQualified!: boolean;

  // Region camerounaise de l'utilisateur (Centre, Littoral, Ouest, Sud-Ouest).
  // Utilisee pour personnaliser le feed des tombolas.
  @Prop({ type: String, enum: [...CAMEROON_REGIONS, null], default: null })
  region?: string | null;

  @Prop({ type: Date, default: null })
  referralQualifiedAt?: Date | null;

  @Prop({ type: Number, default: 0 })
  referralRewardsGranted!: number;

  @Prop({ type: Number, default: 0 })
  loyaltyRewardsGranted!: number;

  @Prop({ type: Number, default: 0 })
  freeTicketsBalance!: number;

  @Prop({
    type: [
      {
        source: {
          type: String,
          enum: ['REFERRAL', 'LOYALTY', 'WELCOME'],
          required: true,
        },
        amount: { type: Number, required: true, default: 1 },
        reason: { type: String, required: true },
        createdAt: { type: Date, default: () => new Date() },
        metadata: { type: Object, default: {} },
      },
    ],
    default: [],
  })
  rewardHistory!: RewardHistoryItem[];

  // Date a laquelle le joueur a declare avoir 18 ans ou plus. null = jamais
  // confirme (comptes anterieurs, comptes Google): l'achat est alors refuse
  // tant qu'il n'a pas confirme.
  @Prop({ type: Date, default: null })
  adultConfirmedAt?: Date | null;

  // Le joueur apparait-il dans le fil "X vient de prendre N tickets" ?
  // Seuls prenom + initiale + region sont diffuses; le joueur peut refuser.
  @Prop({ type: Boolean, default: true })
  showInLiveFeed!: boolean;

  // Limite de depense choisie par le joueur (fenetre glissante).
  @Prop({
    type: {
      period: { type: String, enum: SPENDING_PERIODS },
      amount: { type: Number, min: 0 },
      setAt: { type: Date },
    },
    default: null,
    _id: false,
  })
  spendingLimit?: StoredSpendingLimit | null;

  // Assouplissement demande, applique seulement a effectiveAt.
  @Prop({
    type: {
      period: { type: String, enum: [...SPENDING_PERIODS, null] },
      amount: { type: Number, min: 0 },
      remove: { type: Boolean, default: false },
      requestedAt: { type: Date },
      effectiveAt: { type: Date },
    },
    default: null,
    _id: false,
  })
  pendingSpendingLimit?: StoredPendingSpendingLimit | null;

  @Prop({ default: '/assets/img/profile.svg' })
  avatar!: string;

  @Prop({ type: Object, default: {} })
  profile: Record<string, any>;

  @Prop({ type: String, default: null })
  passwordResetCodeHash?: string | null;

  @Prop({ type: Date, default: null })
  passwordResetCodeExpiresAt?: Date | null;

  @Prop({ type: Date, default: null })
  passwordResetRequestedAt?: Date | null;

  @Prop({ type: Number, default: 0 })
  passwordResetAttempts?: number;

  @Prop({ type: Number, default: 0 })
  failedLoginAttempts?: number;

  @Prop({ type: Date, default: null })
  loginBlockedUntil?: Date | null;

  @Prop({ type: Date, default: null })
  lastLoginAt?: Date | null;

  @Prop({ type: Number, default: 0 })
  tokenVersion?: number;

  @Prop({ type: String, default: null })
  currentRefreshTokenHash?: string | null;

  @Prop({ type: String, default: null })
  currentRefreshTokenJti?: string | null;

  @Prop({ type: Date, default: null })
  currentRefreshTokenIssuedAt?: Date | null;
}

export const UserSchema = SchemaFactory.createForClass(User);

// Sparse: plusieurs comptes Google sans telephone sont autorises.
// La migration de deploy remplace l'ancien index phone_1 non-sparse.
UserSchema.index({ phone: 1 }, { unique: true, sparse: true });
UserSchema.index({ referredBy: 1, createdAt: -1 });
UserSchema.index({ role: 1, status: 1 });
UserSchema.index({ createdAt: -1 });
