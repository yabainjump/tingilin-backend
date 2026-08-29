import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';

import { ProductsService } from '../products/products.service';
import { CreateRaffleDto } from './dto/create-raffle.dto';
import { UpdateRaffleDto } from './dto/update-raffle.dto';
import { AdminCreateRaffleDto } from './dto/admin-create-raffle.dto';

import {
  Raffle,
  RaffleDocument,
  RaffleStatus,
  WinnerFulfillmentStatus,
} from './schemas/raffle.schema';
import { Ticket, TicketDocument } from '../tickets/schemas/ticket.schema';
import { Product, ProductDocument } from '../products/schemas/product.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import {
  Transaction,
  TransactionDocument,
} from '../payments/schemas/transaction.schema';
import {
  Participation,
  ParticipationDocument,
} from '../participations/schemas/participation.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { storeOptimizedImageFromDataUrl } from '../../common/uploads/image-storage';
import {
  PROVABLY_FAIR_ALGORITHM,
  PROVABLY_FAIR_FORMULA,
  computeTicketsetHash,
  computeWinningIndex,
  generateServerSeed,
  hashServerSeed,
  verifyDraw,
} from './provably-fair';

@Injectable()
export class RafflesService {
  constructor(
    @InjectModel(Raffle.name)
    private readonly raffleModel: Model<RaffleDocument>,

    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,

    @InjectModel(Ticket.name)
    private readonly ticketModel: Model<TicketDocument>,

    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Transaction.name)
    private readonly txModel: Model<TransactionDocument>,
    @InjectModel(Participation.name)
    private readonly participationModel: Model<ParticipationDocument>,

    private readonly productsService: ProductsService,
    @InjectConnection() private readonly connection: Connection,

    private readonly notifications: NotificationsService,
  ) {}

  private ensureObjectId(id: string, msg = 'Invalid id'): void {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException(msg);
  }

  private toDate(value: unknown, msg = 'Invalid dates'): Date {
    const d = new Date(String(value));
    if (Number.isNaN(d.getTime())) throw new BadRequestException(msg);
    return d;
  }

  private async raffleTitle(raffle: any): Promise<string> {
    const productId = raffle?.productId;
    if (!productId) return 'ce raffle';

    if (typeof productId === 'object' && 'title' in productId) {
      const title = String((productId as any)?.title ?? '').trim();
      if (title) return title;
    }

    const p: any = await this.productModel
      .findById(productId)
      .select('title')
      .lean()
      .exec();
    return String(p?.title ?? '').trim() || 'ce raffle';
  }

  private async participantUserIds(
    raffleId: Types.ObjectId | string,
  ): Promise<string[]> {
    const rid =
      typeof raffleId === 'string' ? new Types.ObjectId(raffleId) : raffleId;
    const ids = await this.ticketModel.distinct('userId', {
      raffleId: rid,
      status: { $in: ['ACTIVE', 'WINNER'] },
    });
    return Array.from(
      new Set(
        (ids ?? []).map((x: any) => String(x ?? '').trim()).filter(Boolean),
      ),
    );
  }

  private async notifyDrawStarted(raffle: any, users: string[]): Promise<void> {
    if (!users.length) return;

    const raffleId = String(raffle?._id ?? '').trim();
    if (!raffleId) return;

    const title = await this.raffleTitle(raffle);
    await Promise.all(
      users.map((userId) =>
        this.notifications.createOnce({
          userId,
          type: 'DRAW_STARTED',
          title: 'Tirage lancé 🎬',
          body: `Le tirage de "${title}" démarre maintenant.`,
          dedupeKey: `draw-started:${raffleId}`,
          data: {
            raffleId,
            deepLink: '/tabs/winners',
          },
        }),
      ),
    );
  }

  private async notifyDrawResults(
    raffle: any,
    winnerUserId: string,
    users: string[],
  ): Promise<void> {
    if (!users.length) return;

    const raffleId = String(raffle?._id ?? '').trim();
    if (!raffleId) return;

    const title = await this.raffleTitle(raffle);
    const losers = users.filter((u) => String(u) !== String(winnerUserId));
    if (!losers.length) return;

    await Promise.all(
      losers.map((userId) =>
        this.notifications.createOnce({
          userId,
          type: 'DRAW_RESULT',
          title: 'Résultat du tirage disponible',
          body: `Le tirage de "${title}" est terminé. Appuie pour voir le résultat.`,
          dedupeKey: `draw-result:${raffleId}`,
          data: {
            raffleId,
            deepLink: `/tabs/raffle-details/${raffleId}`,
          },
        }),
      ),
    );
  }

  async notifyEndingSoonMilestones(): Promise<void> {
    const now = Date.now();
    const maxWindowMin = 60;
    const upper = new Date(now + maxWindowMin * 60_000);

    const raffles: any[] = await this.raffleModel
      .find({
        status: RaffleStatus.LIVE,
        endAt: { $gt: new Date(now), $lte: upper },
      })
      .select('_id endAt productId')
      .populate({ path: 'productId', select: 'title' })
      .lean()
      .exec();

    for (const raffle of raffles) {
      const endAt = raffle?.endAt ? new Date(raffle.endAt).getTime() : NaN;
      if (!Number.isFinite(endAt)) continue;

      const remainingMin = Math.ceil((endAt - now) / 60_000);
      if (remainingMin <= 0) continue;

      const windowMin = remainingMin <= 5 ? 5 : remainingMin <= 15 ? 15 : 60;

      const raffleId = String(raffle?._id ?? '').trim();
      if (!raffleId) continue;

      const users = await this.participantUserIds(raffleId);
      if (!users.length) continue;

      const title = await this.raffleTitle(raffle);
      await Promise.all(
        users.map((userId) =>
          this.notifications.createOnce({
            userId,
            type: 'ENDING_SOON',
            title: 'Le tirage se termine bientôt ⏳',
            body: `"${title}" se termine dans environ ${windowMin} minute(s).`,
            dedupeKey: `ending-soon:${raffleId}:${windowMin}`,
            data: {
              raffleId,
              windowMin,
              deepLink: `/tabs/raffle-details/${raffleId}`,
            },
          }),
        ),
      );
    }
  }

  async listPublic(opts?: {
    limit?: number;
    sort?: 'endAt' | 'createdAt';
    category?: string;
  }) {
    const limit = Math.min(Math.max(Number(opts?.limit ?? 30), 1), 100);
    const now = new Date();
    const category = String(opts?.category ?? '')
      .trim()
      .toUpperCase();

    const sort =
      opts?.sort === 'endAt' ? { endAt: 1, createdAt: -1 } : { createdAt: -1 };

    // Pour "Ending Soon", on veut uniquement les raffles encore jouables.
    // Sans ça, les raffles déjà terminés peuvent saturer le top N.
    const match =
      opts?.sort === 'endAt'
        ? {
            status: RaffleStatus.LIVE,
            endAt: { $gt: now },
            $or: [{ startAt: { $exists: false } }, { startAt: { $lte: now } }],
          }
        : {
            status: {
              $in: [RaffleStatus.LIVE, RaffleStatus.CLOSED, RaffleStatus.DRAWN],
            },
          };

    if (category && category !== 'ALL') {
      const productIds = await this.productModel
        .find({ categoryId: category })
        .select('_id')
        .lean()
        .exec();

      if (!productIds.length) {
        return [];
      }

      (match as any).productId = {
        $in: productIds.map((row: any) => row._id),
      };
    }

    const raffles = await this.raffleModel
      .find(match as any)
      .populate('productId', 'title description imageUrl categoryId')
      .sort(sort as any)
      .limit(limit)
      .lean()
      .exec();

    return raffles.map((r: any) => {
      const p = r.productId || {};
      const endAt = r.endAt ? new Date(r.endAt).toISOString() : undefined;

      let badgeText = 'LIVE';
      let badgeType: 'danger' | 'warn' | 'hot' = 'hot';

      if (endAt) {
        const ms = new Date(endAt).getTime() - Date.now();
        if (ms <= 0) {
          badgeText = 'ENDED';
          badgeType = 'danger';
        } else if (ms <= 2 * 60 * 60 * 1000) {
          badgeText = 'CLOSING';
          badgeType = 'danger';
        } else if (ms <= 24 * 60 * 60 * 1000) {
          badgeText = 'TODAY';
          badgeType = 'warn';
        }
      }

      return {
        id: r._id?.toString(),
        title: p.title ?? '—',
        subtitle: p.description ?? '',
        imageUrl: p.imageUrl ?? '',
        categoryId: String(p.categoryId ?? ''),
        status: r.status ?? RaffleStatus.LIVE,
        sold: r.ticketsSold ?? 0,
        total: r.totalTickets ?? 0,
        ticketPrice: Number(r.ticketPrice ?? 0),
        currency: String(r.currency ?? 'XAF'),
        startAt: r.startAt ? new Date(r.startAt).toISOString() : undefined,
        endAt,
        endsAt: endAt,
        badgeText,
        badgeType,
      };
    });
  }

  async getHomeFeed(opts?: { category?: string }) {
    const category = String(opts?.category ?? '')
      .trim()
      .toUpperCase();

    const [endingSoon, liveRows] = await Promise.all([
      this.listPublic({ limit: 10, sort: 'endAt', category }),
      this.listPublic({ limit: 30, sort: 'createdAt', category }),
    ]);

    return { endingSoon, liveRows };
  }

  async getPublicDetails(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid id');
    }

    const r = await this.raffleModel
      .findOne({
        _id: id,
        status: {
          $in: [RaffleStatus.LIVE, RaffleStatus.CLOSED, RaffleStatus.DRAWN],
        },
      })
      .populate({
        path: 'productId',
        select: 'title description imageUrl categoryId status',
      })
      .lean()
      .exec();

    if (!r) throw new NotFoundException('Raffle not found');

    const p: any = r.productId;
    if (!p || String(p.status ?? '') !== 'PUBLISHED') {
      throw new NotFoundException('Raffle not found');
    }

    return {
      id: r._id.toString(),

      title: p?.title ?? '',
      description: p?.description ?? '',
      imageUrl: p?.imageUrl ?? '',
      ticketPrice: r.ticketPrice,
      currency: r.currency ?? 'XAF',
      sold: r.ticketsSold ?? 0,
      total: r.totalTickets ?? 0,
      startAt: r.startAt ? new Date(r.startAt).toISOString() : null,
      endAt: r.endAt ? new Date(r.endAt).toISOString() : null,
      endsAt: r.endAt ? new Date(r.endAt).toISOString() : null,
      status: r.status,
    };
  }

  async getStats(id: string) {
    const r: any = await this.getPublicById(id);
    const now = Date.now();

    const end = r.endAt ? new Date(r.endAt).getTime() : 0;
    const remainingMs = end ? Math.max(0, end - now) : 0;

    return {
      raffleId: String(r._id),
      status: r.status,
      ticketsSold: r.ticketsSold ?? 0,
      participantsCount: r.participantsCount ?? 0,
      endAt: r.endAt ?? null,
      remainingMs,
    };
  }

  async adminCreate(dto: CreateRaffleDto, createdBy: string) {
    this.ensureObjectId(dto.productId, 'Invalid productId');
    await this.productsService.adminGetById(dto.productId);

    const startAt = this.toDate(dto.startAt);
    const endAt = this.toDate(dto.endAt);

    if (endAt <= startAt) {
      throw new BadRequestException('endAt must be after startAt');
    }

    const totalTickets = (dto as any).totalTickets ?? 1000;

    return this.raffleModel.create({
      productId: new Types.ObjectId(dto.productId),
      ticketPrice: dto.ticketPrice,
      currency: dto.currency ?? 'XAF',
      startAt,
      endAt,
      rules: dto.rules ?? '',
      status: RaffleStatus.DRAFT,
      createdBy: new Types.ObjectId(createdBy),

      totalTickets,
      ticketsSold: 0,
      participantsCount: 0,
      ...this.newDrawCommitment(),
    } as any);
  }

  async adminUpdate(id: string, dto: UpdateRaffleDto) {
    this.ensureObjectId(id);

    if (dto.startAt && dto.endAt) {
      const s = this.toDate(dto.startAt);
      const e = this.toDate(dto.endAt);
      if (e <= s) throw new BadRequestException('endAt must be after startAt');
    }

    const updated = await this.raffleModel
      .findByIdAndUpdate(
        id,
        {
          ...dto,
          ...(dto.startAt ? { startAt: this.toDate(dto.startAt) } : {}),
          ...(dto.endAt ? { endAt: this.toDate(dto.endAt) } : {}),
        } as any,
        { new: true },
      )
      .populate('productId', 'title realValue imageUrl')
      .exec();

    if (!updated) throw new NotFoundException('Raffle not found');
    return this.toAdminRafflePayload(updated as any);
  }

  async adminStart(id: string) {
    this.ensureObjectId(id);
    const r = await this.raffleModel.findById(id).exec();
    if (!r) throw new NotFoundException('Raffle not found');
    if (r.status !== RaffleStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT can be started');
    }
    r.status = RaffleStatus.LIVE;
    return r.save();
  }

  async adminClose(id: string) {
    this.ensureObjectId(id);
    const r = await this.raffleModel.findById(id).exec();
    if (!r) throw new NotFoundException('Raffle not found');
    if (r.status !== RaffleStatus.LIVE) {
      throw new BadRequestException('Only LIVE can be closed');
    }
    r.status = RaffleStatus.CLOSED;
    return r.save();
  }

  private toAdminRafflePayload(rawRaffle: any) {
    const raffle =
      rawRaffle && typeof rawRaffle.toObject === 'function'
        ? rawRaffle.toObject()
        : rawRaffle;

    const product = raffle?.productId;
    const isPopulatedProduct =
      product &&
      typeof product === 'object' &&
      String(product?._id ?? '').length > 0;

    return {
      ...raffle,
      id: String(raffle?._id ?? ''),
      product: isPopulatedProduct
        ? {
            id: String(product._id),
            title: String(product.title ?? ''),
            realValue: Number(product.realValue ?? 0),
            imageUrl: String(product.imageUrl ?? ''),
          }
        : null,
      productId: isPopulatedProduct
        ? String(product._id)
        : String(raffle?.productId ?? ''),
    };
  }

  async adminListAll() {
    const raffles: any[] = await this.raffleModel
      .find()
      .populate('productId', 'title realValue imageUrl')
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    return raffles.map((raffle: any) => this.toAdminRafflePayload(raffle));
  }

  async adminGetById(id: string) {
    this.ensureObjectId(id);
    const r = await this.raffleModel
      .findById(id)
      .populate('productId', 'title realValue imageUrl')
      .lean()
      .exec();
    if (!r) throw new NotFoundException('Raffle not found');
    return this.toAdminRafflePayload(r);
  }

  async adminDeleteRaffle(id: string) {
    this.ensureObjectId(id);
    const raffle = await this.raffleModel.findById(id).exec();
    if (!raffle) throw new NotFoundException('Raffle not found');

    const [ticketsCount, successfulTxCount] = await Promise.all([
      this.ticketModel.countDocuments({ raffleId: raffle._id }).exec(),
      this.txModel
        .countDocuments({
          raffleId: raffle._id,
          status: 'SUCCESS',
        })
        .exec(),
    ]);

    if (ticketsCount > 0 || successfulTxCount > 0) {
      throw new BadRequestException(
        'Cannot delete a raffle with sold tickets or successful payments',
      );
    }

    await Promise.all([
      this.ticketModel.deleteMany({ raffleId: raffle._id }).exec(),
      this.txModel.deleteMany({ raffleId: raffle._id }).exec(),
      this.participationModel.deleteMany({ raffleId: raffle._id }).exec(),
      this.raffleModel.deleteOne({ _id: raffle._id }).exec(),
    ]);

    if (raffle.productId) {
      const stillUsed = await this.raffleModel
        .countDocuments({ productId: raffle.productId })
        .exec();
      if (stillUsed === 0) {
        await this.productModel.deleteOne({ _id: raffle.productId }).exec();
      }
    }

    return { ok: true, id };
  }

  private parseWinnerStatusFilter(
    raw?: string,
  ): WinnerFulfillmentStatus | null {
    const value = String(raw ?? 'ALL')
      .trim()
      .toUpperCase();
    if (!value || value === 'ALL') return null;

    const allowed = Object.values(WinnerFulfillmentStatus);
    if (!allowed.includes(value as WinnerFulfillmentStatus)) {
      throw new BadRequestException('Invalid winner status filter');
    }

    return value as WinnerFulfillmentStatus;
  }

  private parseWinnerStatusInput(raw?: string): WinnerFulfillmentStatus {
    const value = String(raw ?? '')
      .trim()
      .toUpperCase();
    const allowed = Object.values(WinnerFulfillmentStatus);

    if (!allowed.includes(value as WinnerFulfillmentStatus)) {
      throw new BadRequestException('Invalid winner status');
    }

    return value as WinnerFulfillmentStatus;
  }

  private escapeCsvCell(value: unknown): string {
    let input = '';
    if (typeof value === 'string') input = value;
    else if (typeof value === 'number') input = value.toString();
    else if (typeof value === 'boolean') input = value ? 'true' : 'false';
    else if (typeof value === 'bigint') input = value.toString();
    else if (value != null) input = JSON.stringify(value) ?? '';
    const safe = /^[\s]*[=+\-@]/.test(input) ? `'${input}` : input;
    if (!/[",\n\r]/.test(safe)) return safe;
    return `"${safe.replace(/"/g, '""')}"`;
  }

  async adminListWinners(params?: {
    search?: string;
    status?:
      | 'ALL'
      | 'PENDING_VERIFICATION'
      | 'VERIFIED'
      | 'IN_SHIPPING'
      | 'DELIVERED';
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(1, Number(params?.page ?? 1) || 1);
    const limit = Math.min(100, Math.max(1, Number(params?.limit ?? 20) || 20));
    const skip = (page - 1) * limit;

    const statusFilter = this.parseWinnerStatusFilter(params?.status);
    const search = String(params?.search ?? '').trim();

    const baseMatch = {
      status: RaffleStatus.DRAWN,
      winner: { $ne: null },
      'winner.isPublished': true,
    };

    const stages: any[] = [
      { $match: baseMatch },
      {
        $lookup: {
          from: 'users',
          localField: 'winner.userId',
          foreignField: '_id',
          as: 'user',
        },
      },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'products',
          localField: 'productId',
          foreignField: '_id',
          as: 'product',
        },
      },
      { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'tickets',
          localField: 'winner.ticketId',
          foreignField: '_id',
          as: 'ticket',
        },
      },
      { $unwind: { path: '$ticket', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          winnerStatus: {
            $ifNull: [
              '$winner.fulfillmentStatus',
              WinnerFulfillmentStatus.PENDING_VERIFICATION,
            ],
          },
        },
      },
    ];

    if (statusFilter) {
      stages.push({ $match: { winnerStatus: statusFilter } });
    }

    if (search) {
      const regex = new RegExp(search, 'i');
      stages.push({
        $match: {
          $or: [
            { 'user.firstName': regex },
            { 'user.lastName': regex },
            { 'user.username': regex },
            { 'user.email': regex },
            { 'product.title': regex },
            { 'ticket.serial': regex },
          ],
        },
      });
    }

    const [result] = await this.raffleModel
      .aggregate([
        ...stages,
        { $sort: { 'winner.drawnAt': -1 } },
        {
          $facet: {
            data: [
              { $skip: skip },
              { $limit: limit },
              {
                $project: {
                  raffleId: { $toString: '$_id' },
                  raffleDate: '$winner.drawnAt',
                  status: '$winnerStatus',
                  ticketSerial: '$ticket.serial',
                  productTitle: '$product.title',
                  productSubtitle: '$product.description',
                  productImageUrl: '$product.imageUrl',
                  prizeValue: { $ifNull: ['$product.realValue', 0] },
                  winnerUserId: {
                    $cond: [
                      { $ifNull: ['$winner.userId', false] },
                      { $toString: '$winner.userId' },
                      null,
                    ],
                  },
                  winnerFirstName: '$user.firstName',
                  winnerLastName: '$user.lastName',
                  winnerUsername: '$user.username',
                  winnerEmail: '$user.email',
                  winnerAvatar: '$user.avatar',
                  winnerPhone: '$user.phone',
                  winnerRole: '$user.role',
                  winnerAccountStatus: '$user.status',
                },
              },
            ],
            total: [{ $count: 'count' }],
          },
        },
      ])
      .exec();

    const rows = Array.isArray(result?.data) ? result.data : [];
    const total = Number(result?.total?.[0]?.count ?? 0);

    const [summary] = await this.raffleModel
      .aggregate([
        { $match: baseMatch },
        {
          $lookup: {
            from: 'products',
            localField: 'productId',
            foreignField: '_id',
            as: 'product',
          },
        },
        { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
        {
          $addFields: {
            winnerStatus: {
              $ifNull: [
                '$winner.fulfillmentStatus',
                WinnerFulfillmentStatus.PENDING_VERIFICATION,
              ],
            },
          },
        },
        {
          $group: {
            _id: null,
            totalWinners: { $sum: 1 },
            deliveredCount: {
              $sum: {
                $cond: [
                  { $eq: ['$winnerStatus', WinnerFulfillmentStatus.DELIVERED] },
                  1,
                  0,
                ],
              },
            },
            pendingActions: {
              $sum: {
                $cond: [
                  {
                    $in: [
                      '$winnerStatus',
                      [
                        WinnerFulfillmentStatus.PENDING_VERIFICATION,
                        WinnerFulfillmentStatus.VERIFIED,
                        WinnerFulfillmentStatus.IN_SHIPPING,
                      ],
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
            totalRewardsXaf: { $sum: { $ifNull: ['$product.realValue', 0] } },
          },
        },
      ])
      .exec();

    const totalWinners = Number(summary?.totalWinners ?? 0);
    const deliveredCount = Number(summary?.deliveredCount ?? 0);
    const pendingActions = Number(summary?.pendingActions ?? 0);
    const totalRewardsXaf = Number(summary?.totalRewardsXaf ?? 0);
    const deliveryRate =
      totalWinners > 0 ? Math.round((deliveredCount / totalWinners) * 100) : 0;

    return {
      data: rows.map((row: any) => {
        const ticketCode = this.toTicketCode(row?.ticketSerial);
        const winnerName =
          [
            String(row?.winnerFirstName ?? '').trim(),
            String(row?.winnerLastName ?? '').trim(),
          ]
            .filter(Boolean)
            .join(' ') ||
          String(row?.winnerUsername ?? '').trim() ||
          String(row?.winnerEmail ?? '').trim() ||
          'Winner';

        return {
          raffleId: String(row?.raffleId ?? ''),
          winnerUserId: row?.winnerUserId ? String(row.winnerUserId) : null,
          winnerName,
          winnerFirstName: String(row?.winnerFirstName ?? ''),
          winnerLastName: String(row?.winnerLastName ?? ''),
          winnerUsername: String(row?.winnerUsername ?? ''),
          winnerEmail: String(row?.winnerEmail ?? ''),
          winnerAvatar: String(row?.winnerAvatar ?? ''),
          winnerPhone: String(row?.winnerPhone ?? ''),
          winnerRole: String(row?.winnerRole ?? ''),
          winnerAccountStatus: String(row?.winnerAccountStatus ?? ''),
          productTitle: String(row?.productTitle ?? 'Prize'),
          productSubtitle: String(row?.productSubtitle ?? ''),
          productImageUrl: String(row?.productImageUrl ?? ''),
          ticketSerial: row?.ticketSerial ? String(row.ticketSerial) : null,
          ticketId: ticketCode ? `TK-${ticketCode}` : null,
          raffleDate: row?.raffleDate ?? null,
          status: this.parseWinnerStatusInput(row?.status),
          prizeValue: Number(row?.prizeValue ?? 0),
        };
      }),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      summary: {
        currency: 'XAF',
        pendingActions,
        totalRewardsXaf,
        deliveriesRate: deliveryRate,
        deliveredCount,
        totalWinners,
      },
    };
  }

  async adminUpdateWinnerStatus(raffleId: string, status: string) {
    this.ensureObjectId(raffleId, 'Invalid raffle id');

    const nextStatus = this.parseWinnerStatusInput(status);
    const raffle: any = await this.raffleModel.findById(raffleId).exec();
    if (!raffle) throw new NotFoundException('Raffle not found');
    if (raffle.status !== RaffleStatus.DRAWN || !raffle.winner) {
      throw new BadRequestException('Raffle has no published winner');
    }

    const currentStatus = this.parseWinnerStatusInput(
      raffle.winner.fulfillmentStatus ??
        WinnerFulfillmentStatus.PENDING_VERIFICATION,
    );

    const allowedTransitions: Record<
      WinnerFulfillmentStatus,
      WinnerFulfillmentStatus[]
    > = {
      [WinnerFulfillmentStatus.PENDING_VERIFICATION]: [
        WinnerFulfillmentStatus.VERIFIED,
      ],
      [WinnerFulfillmentStatus.VERIFIED]: [WinnerFulfillmentStatus.IN_SHIPPING],
      [WinnerFulfillmentStatus.IN_SHIPPING]: [
        WinnerFulfillmentStatus.DELIVERED,
      ],
      [WinnerFulfillmentStatus.DELIVERED]: [],
    };

    if (nextStatus !== currentStatus) {
      const allowed = allowedTransitions[currentStatus] ?? [];
      if (!allowed.includes(nextStatus)) {
        throw new BadRequestException(
          `Invalid winner status transition: ${currentStatus} -> ${nextStatus}`,
        );
      }
    }

    raffle.winner.fulfillmentStatus = nextStatus;
    raffle.winner.fulfillmentUpdatedAt = new Date();
    raffle.markModified('winner');
    await raffle.save();

    return {
      raffleId: String(raffle._id),
      status: nextStatus,
      fulfillmentUpdatedAt: raffle.winner.fulfillmentUpdatedAt,
    };
  }

  async adminExportWinnersCsv(params?: {
    search?: string;
    status?:
      | 'ALL'
      | 'PENDING_VERIFICATION'
      | 'VERIFIED'
      | 'IN_SHIPPING'
      | 'DELIVERED';
  }): Promise<string> {
    const batchSize = 100;
    const first = await this.adminListWinners({
      search: params?.search,
      status: params?.status,
      page: 1,
      limit: batchSize,
    });
    const rows = [...first.data];

    for (let page = 2; page <= first.totalPages; page += 1) {
      const chunk = await this.adminListWinners({
        search: params?.search,
        status: params?.status,
        page,
        limit: batchSize,
      });
      rows.push(...chunk.data);
    }

    const lines = [
      [
        'winner_name',
        'winner_email',
        'product_title',
        'ticket_id',
        'status',
        'raffle_date',
        'prize_value_xaf',
      ].join(','),
      ...rows.map((row: any) =>
        [
          this.escapeCsvCell(row?.winnerName),
          this.escapeCsvCell(row?.winnerEmail),
          this.escapeCsvCell(row?.productTitle),
          this.escapeCsvCell(row?.ticketId),
          this.escapeCsvCell(row?.status),
          this.escapeCsvCell(row?.raffleDate),
          this.escapeCsvCell(row?.prizeValue),
        ].join(','),
      ),
    ];

    return lines.join('\n');
  }

  async incrementStats(
    raffleId: string,
    ticketsDelta: number,
    participantsDelta: number,
    session?: ClientSession,
    requirePurchasable = false,
  ) {
    this.ensureObjectId(raffleId, 'Invalid raffleId');
    const now = new Date();
    const result = await this.raffleModel
      .updateOne(
        {
          _id: raffleId,
          ...(requirePurchasable
            ? {
                status: RaffleStatus.LIVE,
                $and: [
                  {
                    $or: [{ startAt: null }, { startAt: { $lte: now } }],
                  },
                  {
                    $or: [{ endAt: null }, { endAt: { $gt: now } }],
                  },
                ],
              }
            : {}),
          $expr: {
            $or: [
              { $lte: [{ $ifNull: ['$totalTickets', 0] }, 0] },
              {
                $lte: [
                  { $add: [{ $ifNull: ['$ticketsSold', 0] }, ticketsDelta] },
                  '$totalTickets',
                ],
              },
            ],
          },
        },
        {
          $inc: {
            ticketsSold: ticketsDelta,
            participantsCount: participantsDelta,
          },
        },
        { session },
      )
      .exec();
    if (result.modifiedCount !== 1) {
      throw new ConflictException(
        requirePurchasable
          ? 'Raffle is closed or has no tickets left'
          : 'Not enough tickets left for this raffle',
      );
    }
    return result;
  }

  private newDrawCommitment(): {
    drawServerSeed: string;
    drawCommitment: string;
  } {
    const drawServerSeed = generateServerSeed();
    return { drawServerSeed, drawCommitment: hashServerSeed(drawServerSeed) };
  }

  /**
   * Selectionne le ticket gagnant de maniere DETERMINISTE et verifiable.
   * Revele le seed engage a la creation (ou en genere un en mode degrade
   * pour les anciennes tombolas sans engagement: committedBeforeDraw=false).
   */
  private async pickProvablyFairWinner(
    raffleId: Types.ObjectId | string,
  ): Promise<{
    ticket: {
      _id: Types.ObjectId;
      userId: Types.ObjectId;
      serial?: string | null;
    } | null;
    serverSeed: string;
    commitment: string;
    committedBeforeDraw: boolean;
    proof: {
      algorithm: string;
      ticketCount: number;
      ticketsetHash: string;
      winningIndex: number;
      digest: string;
      serials: string[];
    } | null;
  }> {
    const rid =
      typeof raffleId === 'string' ? new Types.ObjectId(raffleId) : raffleId;

    // Lit le seed engage (champ select:false) sans toucher au document principal.
    const seedDoc: any = await this.raffleModel
      .findById(rid)
      .select('+drawServerSeed drawCommitment')
      .lean()
      .exec();

    let serverSeed = String(seedDoc?.drawServerSeed ?? '').trim();
    let commitment = String(seedDoc?.drawCommitment ?? '').trim();
    let committedBeforeDraw = Boolean(serverSeed && commitment);

    if (!serverSeed || !commitment) {
      const generated = this.newDrawCommitment();
      serverSeed = generated.drawServerSeed;
      commitment = generated.drawCommitment;
      committedBeforeDraw = false;
    }

    const tickets: any[] = await this.ticketModel
      .find({ raffleId: rid, status: 'ACTIVE' })
      .sort({ _id: 1 })
      .select('_id userId serial')
      .lean()
      .exec();

    if (!tickets.length) {
      return {
        ticket: null,
        serverSeed,
        commitment,
        committedBeforeDraw,
        proof: null,
      };
    }

    const orderedSerials = tickets.map((t) =>
      String(t?.serial ?? t?._id ?? '').trim(),
    );
    const ticketsetHash = computeTicketsetHash(orderedSerials);
    const { winningIndex, digest } = computeWinningIndex({
      serverSeed,
      raffleId: rid.toString(),
      ticketsetHash,
      ticketCount: tickets.length,
    });

    const winning = tickets[winningIndex];

    return {
      ticket: {
        _id: winning._id,
        userId: winning.userId,
        serial: winning.serial ?? null,
      },
      serverSeed,
      commitment,
      committedBeforeDraw,
      proof: {
        algorithm: PROVABLY_FAIR_ALGORITHM,
        ticketCount: tickets.length,
        ticketsetHash,
        winningIndex,
        digest,
        serials: orderedSerials,
      },
    };
  }

  /**
   * Donnees publiques de verification du tirage (commit-reveal).
   * Avant le tirage: seul l'engagement (commitment) est expose.
   * Apres le tirage: le seed est revele + toutes les donnees permettant a
   * n'importe qui de recalculer et confirmer le gagnant.
   */
  async getFairness(raffleId: string) {
    this.ensureObjectId(raffleId, 'Invalid raffleId');

    const raffle: any = await this.raffleModel
      .findOne({
        _id: raffleId,
        status: {
          $in: [RaffleStatus.LIVE, RaffleStatus.CLOSED, RaffleStatus.DRAWN],
        },
      })
      .populate({
        path: 'productId',
        select: 'status',
        match: { status: 'PUBLISHED' },
      })
      .select('+drawServerSeed')
      .lean()
      .exec();
    if (!raffle || !raffle.productId) {
      throw new NotFoundException('Raffle not found');
    }

    const base = {
      raffleId: String(raffle._id),
      status: raffle.status,
      algorithm: PROVABLY_FAIR_ALGORITHM,
      formula: PROVABLY_FAIR_FORMULA,
      commitment: raffle.drawCommitment ?? null,
    };

    const proof = raffle.provablyFair ?? null;
    const isDrawn = raffle.status === RaffleStatus.DRAWN;

    if (!isDrawn || !proof) {
      // Le seed reste secret tant que le tirage n'a pas eu lieu.
      return { ...base, revealed: null };
    }

    // L'ensemble des participants est FIGE au tirage (proof.serials): la
    // verification est reproductible meme si des tickets changent de statut
    // ensuite (VOID/remboursement). Repli pour les anciens tirages sans serials
    // enregistres: reconstruction depuis les tickets ACTIVE/WINNER.
    let orderedSerials: string[] = Array.isArray(proof.serials)
      ? proof.serials.map((s: any) => String(s ?? '').trim())
      : [];

    if (!orderedSerials.length) {
      const tickets: any[] = await this.ticketModel
        .find({ raffleId: new Types.ObjectId(String(raffle._id)) })
        .sort({ _id: 1 })
        .select('_id serial status')
        .lean()
        .exec();
      orderedSerials = tickets
        .filter((t) =>
          ['ACTIVE', 'WINNER'].includes(String(t?.status ?? '').toUpperCase()),
        )
        .map((t) => String(t?.serial ?? t?._id ?? '').trim());
    }

    const winningTicketSerial =
      typeof proof.winningIndex === 'number'
        ? (orderedSerials[proof.winningIndex] ?? null)
        : null;

    const verification = verifyDraw({
      serverSeed: String(raffle.drawServerSeed ?? ''),
      commitment: String(raffle.drawCommitment ?? ''),
      raffleId: String(raffle._id),
      orderedSerials,
      expectedWinningIndex: Number(proof.winningIndex),
      expectedTicketsetHash: proof.ticketsetHash,
    });

    return {
      ...base,
      revealed: {
        serverSeed: raffle.drawServerSeed ?? null,
        ticketCount: proof.ticketCount,
        ticketsetHash: proof.ticketsetHash,
        winningIndex: proof.winningIndex,
        digest: proof.digest,
        committedBeforeDraw: proof.committedBeforeDraw,
        revealedAt: proof.revealedAt ?? raffle.drawnAt ?? null,
        drawnAt: raffle.drawnAt ?? null,
        winningTicketSerial,
        winnerUserId: raffle.winnerUserId ? String(raffle.winnerUserId) : null,
        orderedSerials,
      },
      verified: verification.valid,
      verificationIssues: verification.reasons,
    };
  }

  private buildDrawProofUpdate(
    draw: Awaited<ReturnType<RafflesService['pickProvablyFairWinner']>>,
    drawnAt: Date,
  ): Record<string, any> {
    return {
      drawServerSeed: draw.serverSeed,
      drawCommitment: draw.commitment,
      provablyFair: draw.proof
        ? {
            ...draw.proof,
            committedBeforeDraw: draw.committedBeforeDraw,
            revealedAt: drawnAt,
          }
        : null,
    };
  }

  /**
   * Reclame le tirage de maniere ATOMIQUE (un seul appel concurrent reussit,
   * grace au guard winnerTicketId:null) puis declenche les effets de bord
   * (ticket WINNER + notifications) UNE SEULE FOIS. Empeche le double-tirage
   * entre le scheduler (autoClose) et un tirage manuel admin.
   */
  private async performAtomicDraw(
    raffle: any,
    draw: Awaited<ReturnType<RafflesService['pickProvablyFairWinner']>>,
  ): Promise<{ claimed: boolean; doc: any }> {
    const ticket = draw.ticket;
    if (!ticket) return { claimed: false, doc: raffle };

    const drawnAt = new Date();
    const winnerObj = {
      userId: ticket.userId,
      ticketId: ticket._id,
      drawnAt,
      isPublished: true,
      fulfillmentStatus: WinnerFulfillmentStatus.PENDING_VERIFICATION,
      fulfillmentUpdatedAt: new Date(),
    };

    // { winnerTicketId: null } matche aussi un champ absent (Mongo).
    const claimed: any = await this.raffleModel
      .findOneAndUpdate(
        { _id: raffle._id, winnerTicketId: null },
        {
          $set: {
            status: RaffleStatus.DRAWN,
            winnerTicketId: ticket._id,
            winnerUserId: ticket.userId,
            drawnAt,
            winner: winnerObj,
            ...this.buildDrawProofUpdate(draw, drawnAt),
          },
        },
        { new: true },
      )
      .exec();

    if (!claimed) {
      // Un autre process a deja reclame le tirage -> idempotent, AUCUNE re-notif.
      const current: any = await this.raffleModel
        .findById(raffle._id)
        .lean()
        .exec();
      return { claimed: false, doc: current };
    }

    await this.ticketModel
      .updateOne({ _id: ticket._id }, { $set: { status: 'WINNER' } })
      .exec();

    const participantIds = await this.participantUserIds(raffle._id);
    await this.notifyDrawStarted(claimed, participantIds);
    await this.notifications.create({
      userId: String(ticket.userId),
      type: 'WINNER_ANNOUNCED',
      title: '🎉 Félicitations !',
      body: `Tu as gagné la tombola 🎉`,
      data: {
        raffleId: String(raffle._id),
        ticketId: String(ticket._id),
        deepLink: `/tabs/ticket-details/${String(raffle._id)}`,
      },
    });
    await this.notifyDrawResults(
      claimed,
      String(ticket.userId),
      participantIds,
    );

    return { claimed: true, doc: claimed };
  }

  private async pickRandomActiveTicket(
    raffleId: Types.ObjectId | string,
  ): Promise<{
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    serial?: string | null;
  } | null> {
    const rid =
      typeof raffleId === 'string' ? new Types.ObjectId(raffleId) : raffleId;

    const [ticket] = await this.ticketModel
      .aggregate<{
        _id: Types.ObjectId;
        userId: Types.ObjectId;
        serial?: string | null;
      }>([
        { $match: { raffleId: rid, status: 'ACTIVE' } },
        { $sample: { size: 1 } },
        { $project: { _id: 1, userId: 1, serial: 1 } },
      ])
      .exec();

    return ticket ?? null;
  }

  /**
   * Admin draw (manuel). On garde ta logique mais on ajoute:
   * - on set aussi raffle.winner (si ton schema l'a)
   * - on notifie
   */
  async adminDrawWinner(id: string) {
    this.ensureObjectId(id);
    const raffle: any = await this.raffleModel.findById(id).exec();
    if (!raffle) throw new NotFoundException('Raffle not found');

    if (raffle.status !== RaffleStatus.CLOSED) {
      throw new BadRequestException('Raffle must be CLOSED before drawing');
    }
    if (raffle.winnerTicketId || raffle.winner?.ticketId) {
      throw new BadRequestException('Winner already drawn');
    }

    const draw = await this.pickProvablyFairWinner(raffle._id);
    const winner = draw.ticket;
    if (!winner) {
      throw new BadRequestException('No tickets sold');
    }

    // Claim atomique partage avec le tirage automatique (anti double-tirage).
    const { claimed, doc } = await this.performAtomicDraw(raffle, draw);
    if (!claimed) {
      throw new BadRequestException('Winner already drawn');
    }

    return {
      raffleId: raffle._id.toString(),
      status: doc.status,
      winnerTicketId: winner._id.toString(),
      winnerUserId: String(winner.userId),
      serial: winner.serial,
      drawnAt: doc.drawnAt,
    };
  }

  async adminCreateRaffle(dto: AdminCreateRaffleDto, createdBy: string) {
    if (!createdBy || !Types.ObjectId.isValid(createdBy)) {
      throw new BadRequestException('Invalid createdBy');
    }

    const now = new Date();
    const publishNow = dto.publishNow !== false;

    const startAt = publishNow
      ? now
      : dto.raffle.startAt
        ? new Date(dto.raffle.startAt)
        : now;

    const endAt = new Date(dto.raffle.endAt);

    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      throw new BadRequestException('Invalid dates');
    }
    if (endAt <= startAt) {
      throw new BadRequestException('endAt must be after startAt');
    }

    const categoryId =
      String(dto.product.categoryId ?? 'GENERAL')
        .trim()
        .toUpperCase() || 'GENERAL';
    const imageUrlRaw = String(dto.product.imageUrl ?? '').trim();
    const imageUrl = imageUrlRaw.startsWith('data:')
      ? await storeOptimizedImageFromDataUrl({
          dataUrl: imageUrlRaw,
          kind: 'products',
          prefix: String(createdBy),
          maxWidth: 1600,
          maxHeight: 1600,
          fit: 'inside',
          quality: 82,
        })
      : imageUrlRaw;

    if (!imageUrl) {
      throw new BadRequestException('Product image is required');
    }

    const session = await this.connection.startSession();
    session.startTransaction();

    try {
      const product = await this.productModel.create(
        [
          {
            title: dto.product.title,
            description: dto.product.description ?? '',
            imageUrl,
            categoryId,
            realValue: dto.product.realValue ?? 0,
            createdBy: new Types.ObjectId(createdBy),
          },
        ],
        { session },
      );

      const createdProduct = product[0];

      const raffle = await this.raffleModel.create(
        [
          {
            productId: new Types.ObjectId(createdProduct._id),
            ticketPrice: dto.raffle.ticketPrice,
            currency: dto.raffle.currency ?? 'XAF',
            totalTickets: dto.raffle.totalTickets ?? 0,
            ticketsSold: 0,
            participantsCount: 0,
            startAt,
            endAt,
            rules: dto.raffle.rules ?? '',
            status: publishNow ? RaffleStatus.LIVE : RaffleStatus.DRAFT,
            createdBy: new Types.ObjectId(createdBy),
            badge: dto.raffle.badge ?? '',
            ...this.newDrawCommitment(),
          },
        ],
        { session },
      );

      await session.commitTransaction();

      return {
        product: createdProduct,
        raffle: raffle[0],
      };
    } catch (e) {
      await session.abortTransaction();
      throw e;
    } finally {
      session.endSession();
    }
  }

  async listLiveForHome(opts: {
    category: string;
    limit: number;
    sort: string;
  }) {
    const category = String(opts.category ?? '')
      .trim()
      .toUpperCase();
    const sortStage = opts.sort === 'endAt' ? { endAt: 1 } : { createdAt: -1 };

    const pipeline: any[] = [
      { $match: { status: RaffleStatus.LIVE } },

      {
        $lookup: {
          from: 'products',
          localField: 'productId',
          foreignField: '_id',
          as: 'product',
        },
      },
      { $unwind: '$product' },
    ];

    if (category && category !== 'ALL') {
      pipeline.push({ $match: { 'product.categoryId': category } });
    }

    pipeline.push({ $sort: sortStage });
    pipeline.push({ $limit: opts.limit });

    pipeline.push({
      $project: {
        id: { $toString: '$_id' },
        title: '$product.title',
        imageUrl: '$product.imageUrl',
        badge: '$badge',
        total: '$totalTickets',
        sold: '$ticketsSold',
        ticketPrice: '$ticketPrice',
        currency: '$currency',
        endAt: '$endAt',
      },
    });

    return this.raffleModel.aggregate(pipeline).exec();
  }

  async getPublicById(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid id');
    }

    const r = await this.raffleModel
      .findOne({
        _id: id,
        status: {
          $in: [RaffleStatus.LIVE, RaffleStatus.CLOSED, RaffleStatus.DRAWN],
        },
      })
      .lean()
      .exec();
    if (!r) throw new NotFoundException('Raffle not found');
    return r;
  }

  async listForHome() {
    const now = new Date();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const minEndAt = new Date(Date.now() - sevenDaysMs);
    const publishedProductIds = await this.productModel
      .distinct('_id', { status: 'PUBLISHED' })
      .exec();

    const q: any = {
      status: {
        $in: [RaffleStatus.LIVE, RaffleStatus.CLOSED, RaffleStatus.DRAWN],
      },
      productId: { $in: publishedProductIds },
      endAt: { $gte: minEndAt },
      $or: [{ startAt: null }, { startAt: { $lte: now } }],
    };

    return this.raffleModel.find(q).sort({ endAt: 1 }).lean().exec();
  }

  // ✅ Tirage FAIR: 1 ticket = 1 chance (auto/manuel)
  async drawWinner(raffleId: string) {
    this.ensureObjectId(raffleId, 'Invalid raffleId');

    const raffle: any = await this.raffleModel.findById(raffleId).exec();
    if (!raffle) throw new NotFoundException('Raffle not found');

    // idempotent
    if (raffle.status === RaffleStatus.DRAWN && raffle.winner) {
      return { ok: true, alreadyDrawn: true, winner: raffle.winner };
    }

    const endMs = raffle.endAt ? new Date(raffle.endAt).getTime() : 0;

    // encore LIVE et pas fini => refuse
    if (raffle.status === RaffleStatus.LIVE && endMs && Date.now() < endMs) {
      throw new BadRequestException('Raffle is still LIVE');
    }

    // si LIVE mais fini => fermer
    if (raffle.status === RaffleStatus.LIVE) {
      raffle.status = RaffleStatus.CLOSED;
      await raffle.save();
    }

    const draw = await this.pickProvablyFairWinner(raffle._id);
    const ticket = draw.ticket;
    if (!ticket) {
      // Cloture sans gagnant (atomique, sans ecraser un tirage deja effectue).
      await this.raffleModel
        .updateOne(
          { _id: raffle._id, status: { $ne: RaffleStatus.DRAWN } },
          { $set: { status: RaffleStatus.CLOSED, winner: null } },
        )
        .exec();
      return { ok: true, status: RaffleStatus.CLOSED, winner: null };
    }

    const { claimed, doc } = await this.performAtomicDraw(raffle, draw);
    if (!claimed) {
      return {
        ok: true,
        alreadyDrawn: true,
        status: doc?.status,
        winner: doc?.winner ?? null,
      };
    }

    return { ok: true, status: doc.status, winner: doc.winner };
  }

  // ✅ Auto-close + auto-draw (appelé par cron)
  async autoCloseAndDrawExpired() {
    const now = new Date();

    const expired = await this.raffleModel.find({
      status: RaffleStatus.LIVE,
      endAt: { $lte: now },
    });

    for (const r of expired) {
      try {
        await this.drawWinner(String(r._id));
      } catch {
        // ignore
      }
    }
  }

  private toTicketCode(serial?: string | null): string {
    const s = String(serial ?? '').trim();
    if (!s) return '';
    const last = s.split('-').pop() || s;
    return last.slice(-4).toUpperCase();
  }

  private pickWinnerName(u: any): string {
    return (
      u?.username ||
      u?.fullName ||
      u?.name ||
      [u?.firstName, u?.lastName].filter(Boolean).join(' ') ||
      'Winner'
    );
  }

  private pickAvatar(u: any): string {
    return u?.avatarUrl || u?.photoUrl || u?.avatar || u?.photo;
  }

  async getWinnerPublic(raffleId: string) {
    this.ensureObjectId(raffleId, 'Invalid raffleId');

    const raffle: any = await this.raffleModel
      .findOne({
        _id: raffleId,
        status: {
          $in: [RaffleStatus.LIVE, RaffleStatus.CLOSED, RaffleStatus.DRAWN],
        },
      })
      .populate({
        path: 'productId',
        select: 'title imageUrl status',
        match: { status: 'PUBLISHED' },
      })
      .exec();

    if (!raffle || !raffle.productId) {
      throw new NotFoundException('Raffle not found');
    }

    const winnerObj = raffle.winner || null;

    if (
      raffle.status !== RaffleStatus.DRAWN ||
      !winnerObj ||
      winnerObj.isPublished !== true
    ) {
      return {
        raffleId: String(raffle._id),
        status: raffle.status,
        winner: null,
      };
    }

    // ✅ On prend le ticket seulement pour récupérer le serial (pas besoin de populate)
    const ticket: any = await this.ticketModel
      .findById(winnerObj.ticketId)
      .select('serial')
      .lean()
      .exec();

    // ✅ On récupère le user gagnant via userModel (fiable)
    const user: any = await this.userModel
      .findById(winnerObj.userId)
      .select(
        'username firstName lastName name fullName avatar avatarUrl photo photoUrl',
      )
      .lean()
      .exec();

    const p: any = raffle.productId || {};
    const ticketSerial = ticket?.serial ?? null;

    return {
      raffleId: String(raffle._id),
      status: raffle.status,
      prizeTitle: p?.title ?? null,
      prizeImageUrl: p?.imageUrl ?? null,
      winner: {
        userId: String(winnerObj.userId),
        name: this.pickWinnerName(user),
        avatarUrl: this.pickAvatar(user),
        ticketId: String(winnerObj.ticketId),
        ticketSerial,
        ticketCode: this.toTicketCode(ticketSerial),
        drawnAt: winnerObj.drawnAt,
      },
    };
  }

  async listWinnersPublic(limit = 10) {
    const n = Math.min(50, Math.max(1, Number(limit) || 10));

    const raffles: any[] = await this.raffleModel
      .find({ status: RaffleStatus.DRAWN, 'winner.isPublished': true })
      .populate({
        path: 'productId',
        select: 'title imageUrl status',
        match: { status: 'PUBLISHED' },
      })
      .sort({ 'winner.drawnAt': -1 })
      .limit(n)
      .lean()
      .exec();

    const out: any[] = [];

    for (let i = 0; i < raffles.length; i++) {
      const r = raffles[i];
      const w = r.winner;
      if (!w || !r.productId) continue;

      const [ticket, user] = await Promise.all([
        this.ticketModel.findById(w.ticketId).select('serial').lean().exec(),
        this.userModel
          .findById(w.userId)
          .select(
            'username firstName lastName name fullName avatar avatarUrl photo photoUrl',
          )
          .lean()
          .exec(),
      ]);

      const p: any = r.productId || {};
      const ticketSerial = ticket?.serial ?? null;

      // simple tone pour ton UI
      const badgeTone = i === 0 ? 'gold' : i % 2 === 0 ? 'pink' : 'violet';

      out.push({
        raffleId: String(r._id),
        drawnAt: w.drawnAt,
        prizeTitle: p?.title ?? null,
        prizeImageUrl: p?.imageUrl ?? null,

        winnerName: this.pickWinnerName(user),
        avatar: this.pickAvatar(user),
        ticketSerial,
        ticketCode: this.toTicketCode(ticketSerial),
        badgeTone,
      });
    }

    return { data: out };
  }
}
