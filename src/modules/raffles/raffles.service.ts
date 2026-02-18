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

@Injectable()
export class RafflesService {
  constructor(
    @InjectModel(Raffle.name)
    private readonly raffleModel: Model<RaffleDocument>,

    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,

    @InjectModel(Ticket.name)
    private readonly ticketModel: Model<TicketDocument>,

    private readonly productsService: ProductsService,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  // =======================
  // Helpers
  // =======================
  private ensureObjectId(id: string, msg = 'Invalid id'): void {
    if (!Types.ObjectId.isValid(id)) throw new BadRequestException(msg);
  }

  private toDate(value: unknown, msg = 'Invalid dates'): Date {
    const d = new Date(String(value));
    if (Number.isNaN(d.getTime())) throw new BadRequestException(msg);
    return d;
  }

  // =======================
  // Public
  // =======================
  async listPublic(opts?: { limit?: number; sort?: 'endAt' | 'createdAt' }) {
    const limit = Math.min(Math.max(Number(opts?.limit ?? 30), 1), 100);

    const sort =
      opts?.sort === 'endAt' ? { endAt: 1, createdAt: -1 } : { createdAt: -1 };

    // ✅ IMPORTANT: populate productId pour récupérer title/imageUrl
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
      const endsAt = r.endAt ? new Date(r.endAt).toISOString() : undefined;

      let badgeText = 'LIVE';
      let badgeType: 'danger' | 'warn' | 'hot' = 'hot';

      if (endsAt) {
        const ms = new Date(endsAt).getTime() - Date.now();
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
        sold: r.ticketsSold ?? 0,
        total: r.totalTickets ?? 0,
        endsAt,
        badgeText,
        badgeType,
      };
    });
  }

  // async getPublicById(id: string) {
  //   this.ensureObjectId(id);

  //   try {
  //     const r = await this.raffleModel
  //       .findById(id)
  //       .populate({
  //         path: 'productId',
  //         select: 'title description imageUrl categoryId realValue',
  //       })
  //       .lean()
  //       .exec();

  //     if (!r) throw new NotFoundException('Raffle not found');
  //     return r;
  //   } catch (e: any) {
  //     if (e?.name === 'CastError') throw new BadRequestException('Invalid id');
  //     throw e;
  //   }
  // }

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

      // produit
      title: p?.title ?? '',
      description: p?.description ?? '',
      imageUrl: p?.imageUrl ?? '',
      realValue: p?.realValue ?? 0,

      // raffle
      ticketPrice: r.ticketPrice,
      currency: r.currency ?? 'XAF',
      sold: r.ticketsSold ?? 0,
      total: r.totalTickets ?? 0,
      endsAt: r.endAt ? new Date(r.endAt).toISOString() : null,
      status: r.status,
    };
  }

  async getStats(id: string) {
    const r: any = await this.getPublicById(id);
    const now = Date.now();
    const end = new Date(r.endAt).getTime();
    const remainingMs = Math.max(0, end - now);

    return {
      raffleId: String(r._id),
      status: r.status,
      ticketsSold: r.ticketsSold,
      participantsCount: r.participantsCount,
      endAt: r.endAt,
      remainingMs,
    };
  }

  // =======================
  // Admin (existant)
  // =======================
  async adminCreate(dto: CreateRaffleDto, createdBy: string) {
    this.ensureObjectId(dto.productId, 'Invalid productId');
    await this.productsService.adminGetById(dto.productId);

    const startAt = this.toDate(dto.startAt);
    const endAt = this.toDate(dto.endAt);

    if (endAt <= startAt) {
      throw new BadRequestException('endAt must be after startAt');
    }

    // si ton schema exige totalTickets, mets un default safe
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

      // safe defaults (si présents dans le schema)
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

  async adminDrawWinner(id: string) {
    this.ensureObjectId(id);
    const raffle = await this.raffleModel.findById(id).exec();
    if (!raffle) throw new NotFoundException('Raffle not found');

    if (raffle.status !== RaffleStatus.CLOSED) {
      throw new BadRequestException('Raffle must be CLOSED before drawing');
    }
    if (raffle.winnerTicketId) {
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

    raffle.winnerTicketId = winner._id as any;
    raffle.winnerUserId = winner.userId as any;
    raffle.drawnAt = new Date() as any;
    raffle.status = RaffleStatus.DRAWN;

    await raffle.save();

    await this.ticketModel
      .updateOne({ _id: winner._id }, { $set: { status: 'WINNER' } })
      .exec();

    return {
      raffleId: raffle._id.toString(),
      status: raffle.status,
      winnerTicketId: winner._id.toString(),
      winnerUserId: String(winner.userId),
      serial: winner.serial,
      drawnAt: raffle.drawnAt,
    };
  }

  // async adminCreateRaffle(dto: AdminCreateRaffleDto, createdBy: string) {
  //   if (!Types.ObjectId.isValid(createdBy)) {
  //     throw new BadRequestException('Invalid createdBy');
  //   }

  //   const publishNow = dto.publishNow !== false; // default true
  //   const now = new Date();

  //   const startAt = publishNow
  //     ? now
  //     : dto.raffle.startAt
  //       ? new Date(dto.raffle.startAt)
  //       : now;

  //   const endAt = new Date(dto.raffle.endAt);

  //   if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
  //     throw new BadRequestException('Invalid dates');
  //   }
  //   if (endAt <= startAt) {
  //     throw new BadRequestException('endAt must be after startAt');
  //   }

  //   const categoryId =
  //     dto.product.categoryId && dto.product.categoryId.trim()
  //       ? dto.product.categoryId.trim()
  //       : 'all'; // fallback

  //   const product = await this.productModel.create({
  //     title: dto.product.title,
  //     description: dto.product.description ?? '',
  //     imageUrl: dto.product.imageUrl,

  //     categoryId,
  //     createdBy: new Types.ObjectId(createdBy),

  //     realValue: dto.product.realValue ?? 0,
  //   });

  //   try {
  //     const rafflePayload: any = {
  //       productId: product._id,
  //       ticketPrice: dto.raffle.ticketPrice,
  //       currency: dto.raffle.currency ?? 'XAF',
  //       startAt,
  //       endAt,
  //       rules: dto.raffle.rules ?? '',
  //       status: publishNow ? RaffleStatus.LIVE : RaffleStatus.DRAFT,
  //       createdBy: new Types.ObjectId(createdBy),
  //       badge: dto.raffle.badge ?? '',
  //     };

  //     // optionnels
  //     if (
  //       dto.raffle.totalTickets !== undefined &&
  //       dto.raffle.totalTickets !== null
  //     ) {
  //       rafflePayload.totalTickets = Number(dto.raffle.totalTickets);
  //     }

  //     const raffle = await this.raffleModel.create(rafflePayload);

  //     return { product, raffle };
  //   } catch (e: any) {
  //     // rollback simple
  //     await this.productModel
  //       .deleteOne({ _id: product._id })
  //       .catch(() => undefined);

  //     // renvoyer un message exploitable (au lieu d’un 500 muet)
  //     throw new BadRequestException(e?.message ?? 'Create raffle failed');
  //   }
  // }

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

    // ✅ categoryId est REQUIRED chez toi → on force une valeur
    const categoryId =
      (dto.product.categoryId && String(dto.product.categoryId).trim()) ||
      'GENERAL';

    const session = await this.connection.startSession();
    session.startTransaction();

    try {
      // 1) Create Product (✅ ajoute createdBy + categoryId)
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

      // 2) Create Raffle
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
}
