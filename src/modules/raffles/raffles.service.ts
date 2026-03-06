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

import { Raffle, RaffleDocument, RaffleStatus } from './schemas/raffle.schema';
import { Ticket, TicketDocument } from '../tickets/schemas/ticket.schema';
import { Product, ProductDocument } from '../products/schemas/product.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
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

  async listPublic(opts?: { limit?: number; sort?: 'endAt' | 'createdAt' }) {
    const limit = Math.min(Math.max(Number(opts?.limit ?? 30), 1), 100);

    const sort =
      opts?.sort === 'endAt' ? { endAt: 1, createdAt: -1 } : { createdAt: -1 };

    const raffles = await this.raffleModel
      .find({
        status: {
          $in: [RaffleStatus.LIVE, RaffleStatus.CLOSED, RaffleStatus.DRAWN],
        },
      })
      .populate('productId', 'title description imageUrl')
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
        status: r.status ?? RaffleStatus.LIVE,
        sold: r.ticketsSold ?? 0,
        total: r.totalTickets ?? 0,
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
      .exec();

    if (!updated) throw new NotFoundException('Raffle not found');
    return updated;
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

  async adminListAll() {
    return this.raffleModel.find().sort({ createdAt: -1 }).exec();
  }

  async adminGetById(id: string) {
    this.ensureObjectId(id);
    const r = await this.raffleModel.findById(id).exec();
    if (!r) throw new NotFoundException('Raffle not found');
    return r;
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
      (dto.product.categoryId && String(dto.product.categoryId).trim()) ||
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

    if (opts.category && opts.category !== 'all') {
      pipeline.push({ $match: { 'product.categoryId': opts.category } });
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
    const twoDaysMs = 2 * 24 * 60 * 60 * 1000;
    const minEndAt = new Date(Date.now() - twoDaysMs);

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
