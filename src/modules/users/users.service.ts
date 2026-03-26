import {
  BadRequestException,
  ConflictException,
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
import {
  Transaction,
  TransactionDocument,
} from '../payments/schemas/transaction.schema';
import {
  Participation,
  ParticipationDocument,
} from '../participations/schemas/participation.schema';
import { UpdateMeDto } from './dto/update-me.dto';
import { NotificationsService } from '../notifications/notifications.service';

type HistoryResult = 'WON' | 'LOST' | 'NONE';
const REFERRAL_TARGET = 10;
const LOYALTY_TARGET = 10;
const DEFAULT_AVATAR_PATH = '/assets/img/profile.svg';

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
    @InjectModel(Transaction.name)
    private readonly txModel: Model<TransactionDocument>,
    @InjectModel(Participation.name)
    private readonly participationModel: Model<ParticipationDocument>,
    private readonly notifications: NotificationsService,
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

  async countUsers(): Promise<number> {
    return this.userModel.countDocuments({}).exec();
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
      username:
        String((user as any).username ?? '').trim() || user.email.split('@')[0],
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      role: user.role,
      status: user.status,
      avatar: this.normalizeAvatar(user.avatar),
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
    if (dto.avatar !== undefined) $set.avatar = this.normalizeAvatar(dto.avatar);

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
    username?: string;
    avatar?: string;
    referredBy?: string | null;
  }) {
    const email = params.email.trim().toLowerCase();
    const username = String(params.username ?? '').trim().toLowerCase();
    const firstName = params.firstName.trim();
    const lastName = params.lastName.trim();
    const phone = params.phone.replace(/\s|-/g, '').trim();
    const referralCode = await this.generateUniqueReferralCode();

    try {
      return await this.userModel.create({
        email,
        username: username || email.split('@')[0],
        passwordHash: params.passwordHash,
        firstName,
        lastName,
        phone,
        avatar: this.normalizeAvatar(params.avatar),
        role: params.role ?? 'USER',
        referralCode,
        referredBy:
          params.referredBy && Types.ObjectId.isValid(params.referredBy)
            ? new Types.ObjectId(params.referredBy)
            : null,
      });
    } catch (error: any) {
      const code = Number(error?.code ?? 0);
      if (code === 11000) {
        const keyPattern = error?.keyPattern ?? {};
        const duplicatedFields = Object.keys(keyPattern);

        if (duplicatedFields.includes('email')) {
          throw new ConflictException('Email already in use');
        }
        if (duplicatedFields.includes('phone')) {
          throw new ConflictException('Phone already in use');
        }
        if (duplicatedFields.includes('referralCode')) {
          throw new ConflictException('Please retry registration');
        }

        throw new ConflictException('Duplicate user data detected');
      }

      throw error;
    }
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
    const encodedCode = encodeURIComponent(String(code ?? '').trim().toUpperCase());
    const appBase = this.publicAppOrigin();
    return `${appBase}/auth/register?ref=${encodedCode}&referralCode=${encodedCode}`;
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
    const updated = await this.userModel
      .findByIdAndUpdate(userId, { role }, { new: true })
      .exec();
    if (!updated) throw new NotFoundException('User not found');
    return updated;
  }

  async updateStatus(userId: string, status: 'ACTIVE' | 'SUSPENDED') {
    const updated = await this.userModel
      .findByIdAndUpdate(userId, { status }, { new: true })
      .exec();
    if (!updated) throw new NotFoundException('User not found');
    return updated;
  }

  async adminDeleteUser(userId: string, actorUserId?: string) {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException('Invalid user id');
    }
    if (actorUserId && String(actorUserId) === String(userId)) {
      throw new BadRequestException('You cannot delete your own account');
    }

    const user = await this.userModel.findById(userId).exec();
    if (!user) throw new NotFoundException('User not found');

    if (user.role === 'ADMIN') {
      const adminsCount = await this.userModel.countDocuments({
        role: 'ADMIN',
      });
      if (adminsCount <= 1) {
        throw new BadRequestException('Cannot delete the last admin account');
      }
    }

    const [ticketsCount, txCount, wonCount] = await Promise.all([
      this.ticketModel.countDocuments({ userId: user._id }).exec(),
      this.txModel.countDocuments({ userId: user._id }).exec(),
      this.raffleModel.countDocuments({ winnerUserId: user._id }).exec(),
    ]);

    if (ticketsCount > 0 || txCount > 0 || wonCount > 0) {
      throw new BadRequestException(
        'User has history data (tickets/payments/wins). Suspend account instead of deleting.',
      );
    }

    await Promise.all([
      this.participationModel.deleteMany({ userId: user._id }).exec(),
      this.userModel.deleteOne({ _id: user._id }).exec(),
    ]);

    return {
      ok: true,
      id: user._id.toString(),
      email: user.email,
    };
  }

  async adminList(params?: {
    search?: string;
    role?: UserRole | 'ALL';
    status?: 'ALL' | 'ACTIVE' | 'SUSPENDED';
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, Number(params?.page ?? 1) || 1);
    const limit = Math.min(100, Math.max(1, Number(params?.limit ?? 20) || 20));
    const skip = (page - 1) * limit;

    const role =
      params?.role && params.role !== 'ALL'
        ? String(params.role).toUpperCase()
        : null;
    const status =
      params?.status && params.status !== 'ALL'
        ? String(params.status).toUpperCase()
        : null;
    const search = String(params?.search ?? '').trim();

    const query: Record<string, any> = {};
    if (role) {
      query.role = role;
    }
    if (status) {
      query.status = status;
    }
    if (search) {
      query.$or = [
        { email: { $regex: search, $options: 'i' } },
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.userModel
        .find(query)
        .select(
          '_id email username firstName lastName phone role status createdAt freeTicketsBalance avatar',
        )
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.userModel.countDocuments(query).exec(),
    ]);

    return {
      data: rows.map((row: any) => ({
        id: String(row._id),
        email: row.email,
        username:
          String(row.username ?? '').trim() ||
          String(row.email ?? '').split('@')[0],
        firstName: row.firstName,
        lastName: row.lastName,
        phone: row.phone,
        avatar: this.normalizeAvatar(row.avatar),
        role: row.role,
        status: row.status,
        freeTicketsBalance: Number(row.freeTicketsBalance ?? 0),
        createdAt: row.createdAt ?? null,
      })),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async getMe(userId: string) {
    const u = await this.userModel.findById(userId).lean().exec();
    if (!u) throw new NotFoundException('User not found');

    return {
      id: String(u._id),
      email: u.email,
      username: String((u as any).username ?? '').trim() || u.email.split('@')[0],
      firstName: u.firstName,
      lastName: u.lastName,
      phone: u.phone,
      role: u.role,
      avatar: this.normalizeAvatar(u.avatar),
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
    const now = Date.now();

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
            raffleId: '$raffle._id',
            status: '$raffle.status',
            endsAt: '$raffle.endAt',
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
      .map((x) => {
        const ticketsCount = Number(x.ticketsCount ?? 0);
        const status = String(x.status ?? '')
          .trim()
          .toUpperCase();
        const endsAt = x.endsAt ? new Date(x.endsAt) : null;
        const endsAtMs = endsAt ? endsAt.getTime() : NaN;

        const isEndedByStatus = ['CLOSED', 'DRAWN', 'FINISHED', 'ENDED'].includes(
          status,
        );
        const isEndedByTime = Number.isFinite(endsAtMs) ? endsAtMs <= now : false;
        const isEnded = isEndedByStatus || isEndedByTime;

        const hasWinner = !!x.winnerUserId;
        const isWon =
          hasWinner && String(x.winnerUserId) === String(userId);

        let result: HistoryResult = 'NONE';
        if (isWon) {
          result = 'WON';
        } else if (isEnded && hasWinner) {
          result = 'LOST';
        }

        return {
          raffleId: x.raffleId ? String(x.raffleId) : '',
          title: String(x.title ?? 'Tombola'),
          imageUrl: String(x.imageUrl ?? ''),
          status: status || undefined,
          endsAt:
            Number.isFinite(endsAtMs) && endsAt
              ? endsAt.toISOString()
              : undefined,
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
    let loyaltyRewardDelta = 0;
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
      loyaltyRewardDelta = delta;
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

    if (loyaltyRewardDelta > 0) {
      await this.notifications.create({
        userId: String(user._id),
        type: 'FREE_TICKET_AVAILABLE',
        title: 'Ticket gratuit disponible 🎁',
        body: `Tu as gagné ${loyaltyRewardDelta} ticket(s) gratuit(s) grâce à ta fidélité.`,
        data: {
          source: 'LOYALTY',
          amount: loyaltyRewardDelta,
          deepLink: '/tabs/referral',
        },
      });
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

          await this.notifications.create({
            userId: String(inviter._id),
            type: 'FREE_TICKET_AVAILABLE',
            title: 'Ticket gratuit disponible 🎁',
            body: `Tu as gagné ${delta} ticket(s) gratuit(s) via le parrainage.`,
            data: {
              source: 'REFERRAL',
              amount: delta,
              deepLink: '/tabs/referral',
            },
          });
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
        avatar: this.normalizeAvatar(r.avatar),
        active: Boolean(r.referralQualified),
        qualifiedAt: r.referralQualifiedAt ?? null,
        createdAt: r.createdAt ?? null,
      })),
      rewardHistory,
    };
  }

  private publicAppOrigin(): string {
    const explicit = this.cleanBase(
      process.env.PUBLIC_APP_URL || process.env.APP_WEB_URL || '',
    );
    if (explicit) return explicit;

    const api = this.cleanBase(
      process.env.PUBLIC_API_URL ||
        process.env.API_PUBLIC_URL ||
        'http://localhost:3000',
    );
    return this.inferAppOriginFromApi(api) || 'http://localhost:8100';
  }

  private cleanBase(raw: string): string {
    return String(raw ?? '')
      .trim()
      .replace(/\/api\/v1\/?$/i, '')
      .replace(/\/+$/, '');
  }

  private inferAppOriginFromApi(apiOrigin: string): string {
    if (!apiOrigin) return '';
    try {
      const u = new URL(apiOrigin);
      const host = String(u.host ?? '');
      if (host.toLowerCase().startsWith('backend.')) {
        const frontendHost = host.slice('backend.'.length);
        if (frontendHost) return `${u.protocol}//${frontendHost}`;
      }
      return '';
    } catch {
      return '';
    }
  }

  private defaultAvatar(): string {
    const appUrl = this.publicAppOrigin();
    if (!appUrl) return DEFAULT_AVATAR_PATH;
    return `${appUrl}${DEFAULT_AVATAR_PATH}`;
  }

  private normalizeAvatar(input?: string | null): string {
    const raw = String(input ?? '').trim();
    const normalized = raw.toLowerCase();

    if (
      !raw ||
      normalized === 'null' ||
      normalized === 'undefined' ||
      normalized === 'profile.svg' ||
      normalized === '../profile.svg' ||
      normalized === 'src/assets/img/profile.svg' ||
      normalized === '../../../../assets/img/profile.svg'
    ) {
      return this.defaultAvatar();
    }

    if (
      raw.startsWith('http://') ||
      raw.startsWith('https://') ||
      raw.startsWith('data:')
    ) {
      return raw;
    }

    if (raw.startsWith('/assets/') || raw.startsWith('/uploads/')) {
      return raw;
    }

    if (raw.startsWith('assets/')) {
      return `/${raw}`;
    }

    if (raw.startsWith('src/assets/')) {
      return `/${raw.replace(/^src\//, '')}`;
    }

    if (raw.startsWith('../assets/')) {
      return `/${raw.replace(/^(\.\.\/)+/, '')}`;
    }

    return raw;
  }

  private formatDateLabel(d: Date): string {
    const s = new Intl.DateTimeFormat('fr-FR', {
      day: '2-digit',
      month: 'short',
    }).format(d);

    return s.replace('.', '');
  }
}
