import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import {
  RewardHistorySource,
  User,
  UserDocument,
  UserRole,
} from './schemas/user.schema';
import { Ticket, TicketDocument } from '../tickets/schemas/ticket.schema';
import { Raffle, RaffleDocument } from '../raffles/schemas/raffle.schema';
import { Product, ProductDocument } from '../products/schemas/product.schema';
import { UpdateMeDto } from './dto/update-me.dto';

type HistoryResult = 'WON' | 'LOST';
const REFERRAL_TARGET = 10;
const LOYALTY_TARGET = 10;

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Ticket.name)
    private readonly ticketModel: Model<TicketDocument>,
    @InjectModel(Raffle.name)
    private readonly raffleModel: Model<RaffleDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
  ) {}

  async findByEmail(email: string) {
    return this.userModel.findOne({ email: email.toLowerCase() }).exec();
  }

  async findByPhone(phone: string) {
    const normalized = String(phone ?? '').replace(/\s|-/g, '').trim();
    if (!normalized) return null;
    return this.userModel.findOne({ phone: normalized }).exec();
  }

  async findByReferralCode(code: string) {
    const normalized = String(code ?? '').trim().toUpperCase();
    if (!normalized) return null;
    return this.userModel.findOne({ referralCode: normalized }).exec();
  }

  async findById(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid user id');
    }
    const user = await this.userModel.findById(id).exec();
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  toPublic(user: UserDocument) {
    return {
      _id: user._id.toString(),
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      role: user.role,
      status: user.status,
      avatar: user.avatar,
      referralCode: user.referralCode,
      freeTicketsBalance: Number(user.freeTicketsBalance ?? 0),
    };
  }

  async updateMe(id: string, dto: UpdateMeDto) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid user id');
    }

    const $set: any = {};
    if (dto.firstName !== undefined) $set.firstName = dto.firstName.trim();
    if (dto.lastName !== undefined) $set.lastName = dto.lastName.trim();
    if (dto.phone !== undefined)
      $set.phone = dto.phone.replace(/\s|-/g, '').trim();
    if (dto.avatar !== undefined) $set.avatar = dto.avatar;

    const updated = await this.userModel
      .findByIdAndUpdate(id, { $set }, { new: true })
      .exec();

    if (!updated) throw new NotFoundException('User not found');
    return updated;
  }

  async createUser(params: {
    email: string;
    passwordHash: string;
    firstName: string;
    lastName: string;
    phone: string;
    role?: UserRole;
    avatar?: string;
    referredBy?: string | null;
  }) {
    const email = params.email.trim().toLowerCase();
    const firstName = params.firstName.trim();
    const lastName = params.lastName.trim();
    const phone = params.phone.replace(/\s|-/g, '').trim();
    const referralCode = await this.generateUniqueReferralCode();

    return this.userModel.create({
      email,
      passwordHash: params.passwordHash,
      firstName,
      lastName,
      phone,
      avatar: params.avatar ?? 'profile.svg',
      role: params.role ?? 'USER',
      referralCode,
      referredBy:
        params.referredBy && Types.ObjectId.isValid(params.referredBy)
          ? new Types.ObjectId(params.referredBy)
          : null,
    });
  }

  private buildRawReferralCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = 'WIN-';
    for (let i = 0; i < 6; i++) {
      out += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return out;
  }

  private async generateUniqueReferralCode(): Promise<string> {
    for (let i = 0; i < 20; i++) {
      const candidate = this.buildRawReferralCode();
      const exists = await this.userModel.exists({ referralCode: candidate });
      if (!exists) return candidate;
    }
    return `WIN-${Date.now().toString(36).toUpperCase()}`;
  }

  private buildReferralLink(code: string): string {
    const base = (process.env.APP_WEB_URL || 'http://localhost:8100').replace(
      /\/+$/,
      '',
    );
    return `${base}/auth/register?ref=${encodeURIComponent(code)}`;
  }

  private appendRewardHistory(
    user: UserDocument,
    input: {
      source: RewardHistorySource;
      reason: string;
      amount?: number;
      metadata?: Record<string, any>;
    },
  ) {
    const current = Array.isArray((user as any).rewardHistory)
      ? (user as any).rewardHistory
      : [];

    current.push({
      source: input.source,
      amount: Math.max(1, Number(input.amount ?? 1)),
      reason: input.reason,
      createdAt: new Date(),
      metadata: input.metadata ?? {},
    });

    // keep latest 100 events to avoid unbounded growth in a single document
    if (current.length > 100) {
      (user as any).rewardHistory = current.slice(-100);
      return;
    }

    (user as any).rewardHistory = current;
  }

  async updateRole(userId: string, role: 'USER' | 'ADMIN' | 'MODERATOR') {
    return this.userModel
      .findByIdAndUpdate(userId, { role }, { new: true })
      .exec();
  }

  async getMe(userId: string) {
    const u = await this.userModel.findById(userId).lean().exec();
    if (!u) throw new NotFoundException('User not found');

    return {
      id: String(u._id),
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      phone: u.phone,
      role: u.role,
      avatar: u.avatar,
      profile: u.profile ?? {},
      referralCode: u.referralCode,
      freeTicketsBalance: Number(u.freeTicketsBalance ?? 0),
    };
  }

  async getMyStats(userId: string) {
    const uid = new Types.ObjectId(userId);

    const u = await this.userModel.findById(uid).lean().exec();
    if (!u) throw new NotFoundException('User not found');

    const balance = Number((u.profile as any)?.balance ?? 0);
    const currency = String((u.profile as any)?.currency ?? 'XAF');

    const [ticketsBought, productsWon] = await Promise.all([
      this.ticketModel.countDocuments({ userId: uid }),
      this.raffleModel.countDocuments({ winnerUserId: uid }),
    ]);

    return {
      balance,
      currency,
      ticketsBought,
      productsWon,
      freeTicketsBalance: Number(u.freeTicketsBalance ?? 0),
    };
  }

  async getMyHistory(userId: string, limit = 5) {
    const uid = new Types.ObjectId(userId);

    const rows = await this.ticketModel
      .aggregate([
        { $match: { userId: uid } },
        {
          $group: {
            _id: '$raffleId',
            ticketsCount: { $sum: 1 },
            lastAt: { $max: '$createdAt' },
          },
        },
        { $sort: { lastAt: -1 } },
        { $limit: limit },

        {
          $lookup: {
            from: 'raffles',
            localField: '_id',
            foreignField: '_id',
            as: 'raffle',
          },
        },
        { $unwind: { path: '$raffle', preserveNullAndEmptyArrays: true } },

        {
          $lookup: {
            from: 'products',
            localField: 'raffle.productId',
            foreignField: '_id',
            as: 'product',
          },
        },
        { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },

        {
          $project: {
            ticketsCount: 1,
            lastAt: 1,
            title: '$product.title',
            imageUrl: '$product.imageUrl',
            winnerUserId: '$raffle.winnerUserId',
          },
        },
      ])
      .exec();

    return rows
      .filter((x) => x?.title)
      .map((x) => {
        const ticketsCount = Number(x.ticketsCount ?? 0);
        const isWon =
          x.winnerUserId && String(x.winnerUserId) === String(userId);

        const result: HistoryResult = isWon ? 'WON' : 'LOST';

        return {
          title: String(x.title),
          imageUrl: String(x.imageUrl ?? ''),
          dateLabel: this.formatDateLabel(
            x.lastAt ? new Date(x.lastAt) : new Date(),
          ),
          ticketsLabel: `${ticketsCount} Ticket${ticketsCount > 1 ? 's' : ''}`,
          result,
        };
      });
  }

  async evaluateMilestones(userId: string) {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user id');
    }

    const uid = new Types.ObjectId(userId);
    const user = await this.userModel.findById(uid).exec();
    if (!user) throw new NotFoundException('User not found');

    const [ticketCount, distinctRaffles] = await Promise.all([
      this.ticketModel.countDocuments({ userId: uid }),
      this.ticketModel.distinct('raffleId', { userId: uid }),
    ]);

    let userChanged = false;
    if (!user.referralCode) {
      user.referralCode = await this.generateUniqueReferralCode();
      userChanged = true;
    }

    const hasPurchasedAtLeastOnce = ticketCount > 0;

    if (user.referredBy && !user.referralQualified && hasPurchasedAtLeastOnce) {
      user.referralQualified = true;
      user.referralQualifiedAt = new Date();
      userChanged = true;
    }

    const playedRafflesCount = distinctRaffles.length;
    const loyaltyTargetRewards = Math.floor(playedRafflesCount / LOYALTY_TARGET);
    const currentLoyaltyRewards = Number(user.loyaltyRewardsGranted ?? 0);

    if (loyaltyTargetRewards > currentLoyaltyRewards) {
      const delta = loyaltyTargetRewards - currentLoyaltyRewards;
      user.loyaltyRewardsGranted = loyaltyTargetRewards;
      user.freeTicketsBalance = Number(user.freeTicketsBalance ?? 0) + delta;

      for (let i = currentLoyaltyRewards + 1; i <= loyaltyTargetRewards; i++) {
        const milestone = i * LOYALTY_TARGET;
        this.appendRewardHistory(user, {
          source: 'LOYALTY',
          amount: 1,
          reason: `Bonus fidélité attribué (+1 ticket)`,
          metadata: { milestone, playedRafflesRequired: LOYALTY_TARGET },
        });
      }

      userChanged = true;
    }

    if (userChanged) {
      await user.save();
    }

    if (user.referredBy) {
      const inviter = await this.userModel.findById(user.referredBy).exec();
      if (inviter) {
        const qualifiedReferrals = await this.userModel.countDocuments({
          referredBy: inviter._id,
          referralQualified: true,
        });

        const referralTargetRewards = Math.floor(
          qualifiedReferrals / REFERRAL_TARGET,
        );
        const currentReferralRewards = Number(
          inviter.referralRewardsGranted ?? 0,
        );

        if (referralTargetRewards > currentReferralRewards) {
          const delta = referralTargetRewards - currentReferralRewards;
          inviter.referralRewardsGranted = referralTargetRewards;
          inviter.freeTicketsBalance =
            Number(inviter.freeTicketsBalance ?? 0) + delta;

          for (
            let i = currentReferralRewards + 1;
            i <= referralTargetRewards;
            i++
          ) {
            const milestone = i * REFERRAL_TARGET;
            this.appendRewardHistory(inviter, {
              source: 'REFERRAL',
              amount: 1,
              reason: `Bonus parrainage attribué (+1 ticket)`,
              metadata: { milestone, qualifiedReferralsRequired: REFERRAL_TARGET },
            });
          }

          await inviter.save();
        }
      }
    }

    const refreshed = await this.userModel.findById(uid).lean().exec();
    return {
      userId,
      freeTicketsBalance: Number(refreshed?.freeTicketsBalance ?? 0),
      referralQualified: Boolean(refreshed?.referralQualified),
      playedRafflesCount,
    };
  }

  async consumeFreeTickets(userId: string, count = 1) {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user id');
    }
    const qty = Math.max(1, Math.floor(Number(count) || 1));

    const updated = await this.userModel
      .findOneAndUpdate(
        {
          _id: new Types.ObjectId(userId),
          freeTicketsBalance: { $gte: qty },
        },
        { $inc: { freeTicketsBalance: -qty } },
        { new: true },
      )
      .exec();

    if (!updated) {
      throw new BadRequestException('Not enough free tickets');
    }
    return updated;
  }

  async getReferralSummary(userId: string) {
    await this.evaluateMilestones(userId);

    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user id');
    }
    const uid = new Types.ObjectId(userId);

    let user = await this.userModel.findById(uid).exec();
    if (!user) throw new NotFoundException('User not found');

    if (!user.referralCode) {
      user.referralCode = await this.generateUniqueReferralCode();
      await user.save();
      user = await this.userModel.findById(uid).exec();
      if (!user) throw new NotFoundException('User not found');
    }

    const [qualifiedReferrals, allReferred, playedRaffles] = await Promise.all([
      this.userModel.countDocuments({
        referredBy: uid,
        referralQualified: true,
      }),
      this.userModel
        .find({ referredBy: uid })
        .select(
          '_id firstName lastName avatar referralQualified referralQualifiedAt createdAt',
        )
        .sort({ createdAt: -1 })
        .limit(100)
        .lean()
        .exec(),
      this.ticketModel.distinct('raffleId', { userId: uid }),
    ]);

    const loyaltyPlayedCount = playedRaffles.length;
    const referralRaw = qualifiedReferrals % REFERRAL_TARGET;
    const referralProgress =
      referralRaw === 0 && qualifiedReferrals > 0
        ? REFERRAL_TARGET
        : referralRaw;
    const loyaltyRaw = loyaltyPlayedCount % LOYALTY_TARGET;
    const loyaltyProgress =
      loyaltyRaw === 0 && loyaltyPlayedCount > 0 ? LOYALTY_TARGET : loyaltyRaw;
    const rewardHistory = (Array.isArray((user as any).rewardHistory)
      ? [...(user as any).rewardHistory]
      : []
    )
      .sort(
        (a: any, b: any) =>
          new Date(b?.createdAt ?? 0).getTime() -
          new Date(a?.createdAt ?? 0).getTime(),
      )
      .map((x: any) => ({
        source: String(x?.source ?? ''),
        amount: Number(x?.amount ?? 1),
        reason: String(x?.reason ?? ''),
        createdAt: x?.createdAt ?? null,
        metadata: x?.metadata ?? {},
      }));

    return {
      referralCode: user.referralCode,
      referralLink: this.buildReferralLink(user.referralCode),
      freeTicketsBalance: Number(user.freeTicketsBalance ?? 0),
      referral: {
        qualifiedReferrals,
        target: REFERRAL_TARGET,
        progress: referralProgress,
        rewardsGranted: Number(user.referralRewardsGranted ?? 0),
      },
      loyalty: {
        playedRafflesCount: loyaltyPlayedCount,
        target: LOYALTY_TARGET,
        progress: loyaltyProgress,
        rewardsGranted: Number(user.loyaltyRewardsGranted ?? 0),
      },
      referrals: allReferred.map((r: any) => ({
        userId: String(r._id),
        firstName: r.firstName,
        lastName: r.lastName,
        avatar: r.avatar,
        active: Boolean(r.referralQualified),
        qualifiedAt: r.referralQualifiedAt ?? null,
        createdAt: r.createdAt ?? null,
      })),
      rewardHistory,
    };
  }

  private formatDateLabel(d: Date): string {
    const s = new Intl.DateTimeFormat('fr-FR', {
      day: '2-digit',
      month: 'short',
    }).format(d);

    return s.replace('.', '');
  }
}
