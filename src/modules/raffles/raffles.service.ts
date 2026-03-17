import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';

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
        (ids ?? [])
          .map((x: any) => String(x ?? '').trim())
          .filter(Boolean),
      ),
    );
  }

  private async notifyDrawStarted(
    raffle: any,
    users: string[],
  ): Promise<void> {
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

      const windowMin =
        remainingMin <= 5 ? 5 : remainingMin <= 15 ? 15 : 60;

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

  async getPublicDetails(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid id');
    }

    const r = await this.raffleModel
      .findById(id)
      .populate({
        path: 'productId',
        select: 'title description imageUrl realValue categoryId',
      })
      .lean()
      .exec();

    if (!r) throw new NotFoundException('Raffle not found');

    const p: any = r.productId;

    return {
      id: r._id.toString(),

      title: p?.title ?? '',
      description: p?.description ?? '',
      imageUrl: p?.imageUrl ?? '',
      realValue: p?.realValue ?? 0,

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
    const value = String(raw ?? 'ALL').trim().toUpperCase();
    if (!value || value === 'ALL') return null;

    const allowed = Object.values(WinnerFulfillmentStatus);
    if (!allowed.includes(value as WinnerFulfillmentStatus)) {
      throw new BadRequestException('Invalid winner status filter');
    }

    return value as WinnerFulfillmentStatus;
  }

  private parseWinnerStatusInput(raw?: string): WinnerFulfillmentStatus {
    const value = String(raw ?? '').trim().toUpperCase();
    const allowed = Object.values(WinnerFulfillmentStatus);

    if (!allowed.includes(value as WinnerFulfillmentStatus)) {
      throw new BadRequestException('Invalid winner status');
    }

    return value as WinnerFulfillmentStatus;
  }

  private escapeCsvCell(value: unknown): string {
    const input = String(value ?? '');
    if (!/[",\n]/.test(input)) return input;
    return `"${input.replace(/"/g, '""')}"`;
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
      totalWinners > 0
        ? Math.round((deliveredCount / totalWinners) * 100)
        : 0;

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
    const rows = await this.adminListWinners({
      search: params?.search,
      status: params?.status,
      page: 1,
      limit: 1000,
    });

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
      ...rows.data.map((row: any) =>
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
  ) {
    this.ensureObjectId(raffleId, 'Invalid raffleId');
    return this.raffleModel
      .updateOne(
        { _id: raffleId },
        {
          $inc: {
            ticketsSold: ticketsDelta,
            participantsCount: participantsDelta,
          },
        },
      )
      .exec();
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

    const tickets = await this.ticketModel
      .find({ raffleId: raffle._id, status: 'ACTIVE' })
      .select({ _id: 1, userId: 1, serial: 1 })
      .exec();

    if (!tickets.length) {
      throw new BadRequestException('No tickets sold');
    }

    const participantIds = Array.from(
      new Set(tickets.map((t) => String(t?.userId ?? '').trim()).filter(Boolean)),
    );
    await this.notifyDrawStarted(raffle, participantIds);

    const idx = Math.floor(Math.random() * tickets.length);
    const winner = tickets[idx];

    // legacy fields (tu les avais déjà)
    raffle.winnerTicketId = winner._id as any;
    raffle.winnerUserId = winner.userId as any;
    raffle.drawnAt = new Date() as any;

    // new winner object (si présent dans schema)
    raffle.winner = {
      userId: winner.userId,
      ticketId: winner._id,
      drawnAt: raffle.drawnAt,
      isPublished: true,
      fulfillmentStatus: WinnerFulfillmentStatus.PENDING_VERIFICATION,
      fulfillmentUpdatedAt: new Date(),
    };

    raffle.status = RaffleStatus.DRAWN;

    await raffle.save();

    await this.ticketModel
      .updateOne({ _id: winner._id }, { $set: { status: 'WINNER' } })
      .exec();

    await this.notifications.create({
      userId: String(winner.userId),
      type: 'WINNER_ANNOUNCED',
      title: '🎉 Félicitations !',
      body: `Tu as gagné la tombola 🎉`,
      data: {
        raffleId: String(raffle._id),
        ticketId: String(winner._id),
        deepLink: `/tabs/ticket-details/${String(raffle._id)}`,
      },
    });

    await this.notifyDrawResults(raffle, String(winner.userId), participantIds);

    return {
      raffleId: raffle._id.toString(),
      status: raffle.status,
      winnerTicketId: winner._id.toString(),
      winnerUserId: String(winner.userId),
      serial: winner.serial,
      drawnAt: raffle.drawnAt,
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
      String(dto.product.categoryId ?? 'GENERAL').trim().toUpperCase() ||
      'GENERAL';

    const session = await this.connection.startSession();
    session.startTransaction();

    try {
      const product = await this.productModel.create(
        [
          {
            title: dto.product.title,
            description: dto.product.description ?? '',
            imageUrl: dto.product.imageUrl,
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

    const r = await this.raffleModel.findById(id).lean().exec();
    if (!r) throw new NotFoundException('Raffle not found');
    return r;
  }

  async listForHome() {
    const now = new Date();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
    const minEndAt = new Date(Date.now() - sevenDaysMs);

    const q: any = {
      endAt: { $gte: minEndAt },
      $or: [{ startAt: { $exists: false } }, { startAt: { $lte: now } }],
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

    const count = await this.ticketModel.countDocuments({
      raffleId: raffle._id,
      status: 'ACTIVE',
    });

    if (!count) {
      raffle.status = RaffleStatus.CLOSED;
      raffle.winner = null;
      await raffle.save();
      return { ok: true, status: raffle.status, winner: null };
    }

    const participantIds = await this.participantUserIds(raffle._id);
    await this.notifyDrawStarted(raffle, participantIds);

    const skip = Math.floor(Math.random() * count);
    const ticket = await this.ticketModel
      .findOne({ raffleId: raffle._id, status: 'ACTIVE' })
      .skip(skip)
      .exec();

    if (!ticket) throw new BadRequestException('No ticket selected');

    // marquer le ticket gagnant (si ton enum TicketStatus l'accepte)
    await this.ticketModel
      .updateOne({ _id: ticket._id }, { $set: { status: 'WINNER' } })
      .exec();

    raffle.status = RaffleStatus.DRAWN;

    // set winner legacy + new
    raffle.winnerTicketId = ticket._id as any;
    raffle.winnerUserId = ticket.userId as any;
    raffle.drawnAt = new Date() as any;

    raffle.winner = {
      userId: ticket.userId,
      ticketId: ticket._id,
      drawnAt: raffle.drawnAt,
      isPublished: true,
      fulfillmentStatus: WinnerFulfillmentStatus.PENDING_VERIFICATION,
      fulfillmentUpdatedAt: new Date(),
    };

    await raffle.save();

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

    await this.notifyDrawResults(raffle, String(ticket.userId), participantIds);

    return { ok: true, status: raffle.status, winner: raffle.winner };
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
      .findById(raffleId)
      .populate('productId', 'title imageUrl')
      .exec();

    if (!raffle) throw new NotFoundException('Raffle not found');

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
      .populate('productId', 'title imageUrl')
      .sort({ 'winner.drawnAt': -1 })
      .limit(n)
      .lean()
      .exec();

    const out: any[] = [];

    for (let i = 0; i < raffles.length; i++) {
      const r = raffles[i];
      const w = r.winner;
      if (!w) continue;

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
