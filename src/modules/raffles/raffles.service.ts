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
  async listPublic() {
    return this.raffleModel
      .find({
        status: {
          $in: [RaffleStatus.LIVE, RaffleStatus.CLOSED, RaffleStatus.DRAWN],
        },
      })
      .populate({
        path: 'productId',
        select: 'title description imageUrl categoryId realValue',
      })
      .sort({ createdAt: -1 })
      .lean()
      .exec();
  }

  async getPublicById(id: string) {
    this.ensureObjectId(id);

    try {
      const r = await this.raffleModel
        .findById(id)
        .populate({
          path: 'productId',
          select: 'title description imageUrl categoryId realValue',
        })
        .lean()
        .exec();

      if (!r) throw new NotFoundException('Raffle not found');
      return r;
    } catch (e: any) {
      if (e?.name === 'CastError') throw new BadRequestException('Invalid id');
      throw e;
    }
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

  // =======================
  // ✅ Admin Create (Product + Raffle en 1 requête)
  // =======================
  // async adminCreateRaffle(dto: AdminCreateRaffleDto, createdBy: string) {
  //   const now = new Date();
  //   const publishNow = dto.publishNow !== false; // default true

  //   const startAt = publishNow
  //     ? now
  //     : dto.raffle.startAt
  //       ? this.toDate(dto.raffle.startAt)
  //       : now;

  //   const endAt = this.toDate(dto.raffle.endAt);

  //   if (endAt <= startAt) {
  //     throw new BadRequestException('endAt must be after startAt');
  //   }
  //   if (publishNow && endAt <= now) {
  //     throw new BadRequestException('endAt doit être dans le futur');
  //   }

  //   // ✅ IMPORTANT: éviter le 500 si ton schema exige totalTickets
  //   const totalTickets = dto.raffle.totalTickets ?? 1000;

  //   const session = await this.connection.startSession();
  //   session.startTransaction();

  //   try {
  //     // 1) Product
  //     const product = new this.productModel({
  //       title: dto.product.title,
  //       description: dto.product.description ?? '',
  //       imageUrl: dto.product.imageUrl,
  //       categoryId: dto.product.categoryId,
  //       realValue: dto.product.realValue ?? 0,
  //     });

  //     await product.save({ session });

  //     // 2) Raffle
  //     const raffle = new this.raffleModel({
  //       productId: new Types.ObjectId(product._id),
  //       ticketPrice: dto.raffle.ticketPrice,
  //       currency: dto.raffle.currency ?? 'XAF',

  //       totalTickets,
  //       ticketsSold: 0,
  //       participantsCount: 0,

  //       startAt,
  //       endAt,
  //       rules: (dto.raffle as any).rules ?? '',
  //       badge: dto.raffle.badge,

  //       status: publishNow ? RaffleStatus.LIVE : RaffleStatus.DRAFT,
  //       createdBy: new Types.ObjectId(createdBy),
  //     } as any);

  //     await raffle.save({ session });

  //     await session.commitTransaction();

  //     return { product, raffle };
  //   } catch (e) {
  //     await session.abortTransaction();
  //     throw e;
  //   } finally {
  //     session.endSession();
  //   }
  // }
  async adminCreateRaffle(dto: AdminCreateRaffleDto, createdBy: string) {
    if (!Types.ObjectId.isValid(createdBy)) {
      throw new BadRequestException('Invalid createdBy');
    }

    const publishNow = dto.publishNow !== false; // default true
    const now = new Date();

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

    // 1) Create Product
    // const product = await this.productModel.create({
    //   title: dto.product.title,
    //   description: dto.product.description ?? '',
    //   imageUrl: dto.product.imageUrl,
    //   categoryId: dto.product.categoryId || undefined,
    //   realValue: dto.product.realValue ?? 0,
    // });

    const categoryId =
      dto.product.categoryId && dto.product.categoryId.trim()
        ? dto.product.categoryId.trim()
        : 'all'; // fallback

    const product = await this.productModel.create({
      title: dto.product.title,
      description: dto.product.description ?? '',
      imageUrl: dto.product.imageUrl,

      // ✅ REQUIRED fields in your Product schema
      categoryId,
      createdBy: new Types.ObjectId(createdBy),

      realValue: dto.product.realValue ?? 0,
    });

    // 2) Create Raffle (si ça échoue => rollback product)
    try {
      const rafflePayload: any = {
        productId: product._id,
        ticketPrice: dto.raffle.ticketPrice,
        currency: dto.raffle.currency ?? 'XAF',
        startAt,
        endAt,
        rules: dto.raffle.rules ?? '',
        status: publishNow ? RaffleStatus.LIVE : RaffleStatus.DRAFT,
        createdBy: new Types.ObjectId(createdBy),
        badge: dto.raffle.badge ?? '',
      };

      // optionnels
      if (
        dto.raffle.totalTickets !== undefined &&
        dto.raffle.totalTickets !== null
      ) {
        rafflePayload.totalTickets = Number(dto.raffle.totalTickets);
      }

      const raffle = await this.raffleModel.create(rafflePayload);

      return { product, raffle };
    } catch (e: any) {
      // rollback simple
      await this.productModel
        .deleteOne({ _id: product._id })
        .catch(() => undefined);

      // renvoyer un message exploitable (au lieu d’un 500 muet)
      throw new BadRequestException(e?.message ?? 'Create raffle failed');
    }
  }
}
