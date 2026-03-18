import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

export type UserRole = 'USER' | 'ADMIN' | 'MODERATOR';
export type UserStatus = 'ACTIVE' | 'SUSPENDED';
export type RewardHistorySource = 'REFERRAL' | 'LOYALTY';

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

  @Prop({ required: true, unique: true, index: true })
  phone!: string;

  @Prop({ unique: true, sparse: true, uppercase: true, trim: true })
  referralCode!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  referredBy?: Types.ObjectId | null;

  @Prop({ type: Boolean, default: false })
  referralQualified!: boolean;

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
          enum: ['REFERRAL', 'LOYALTY'],
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
}

export const UserSchema = SchemaFactory.createForClass(User);
