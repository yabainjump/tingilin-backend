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
  // Public
  // =======================
  async listPublic() {
    return this.raffleModel
      .find({
        status: {
          $in: [RaffleStatus.LIVE, RaffleStatus.CLOSED, RaffleStatus.DRAWN],
        },
      })
      .sort({ createdAt: -1 })
      .exec();
  }

  async getPublicById(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid id');
    }

    try {
      const r = await this.raffleModel.findById(id).lean().exec();
      if (!r) throw new NotFoundException('Raffle not found');
      return r;
    } catch (e: any) {
      if (e?.name === 'CastError') {
        throw new BadRequestException('Invalid id');
      }
      throw e;
    }
  }

  async getStats(id: string) {
    const r = await this.getPublicById(id);
    const now = Date.now();
    const end = new Date(r.endAt).getTime();
    const remainingMs = Math.max(0, end - now);

    return {
      raffleId: r._id.toString(),
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
    await this.productsService.adminGetById(dto.productId);

    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      throw new BadRequestException('Invalid dates');
    }
    if (endAt <= startAt) {
      throw new BadRequestException('endAt must be after startAt');
    }

    return this.raffleModel.create({
      productId: new Types.ObjectId(dto.productId),
      ticketPrice: dto.ticketPrice,
      currency: dto.currency ?? 'XAF',
      startAt,
      endAt,
      rules: dto.rules ?? '',
      status: RaffleStatus.DRAFT,
      createdBy: new Types.ObjectId(createdBy),
    });
  }

  async adminUpdate(id: string, dto: UpdateRaffleDto) {
    if (dto.startAt && dto.endAt) {
      const s = new Date(dto.startAt);
      const e = new Date(dto.endAt);
      if (e <= s) throw new BadRequestException('endAt must be after startAt');
    }

    const updated = await this.raffleModel
      .findByIdAndUpdate(
        id,
        {
          ...dto,
          ...(dto.startAt ? { startAt: new Date(dto.startAt) } : {}),
          ...(dto.endAt ? { endAt: new Date(dto.endAt) } : {}),
        },
        { new: true },
      )
      .exec();

    if (!updated) throw new NotFoundException('Raffle not found');
    return updated;
  }

  async adminStart(id: string) {
    const r = await this.raffleModel.findById(id).exec();
    if (!r) throw new NotFoundException('Raffle not found');
    if (r.status !== RaffleStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT can be started');
    }
    r.status = RaffleStatus.LIVE;
    return r.save();
  }

  async adminClose(id: string) {
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
    const r = await this.raffleModel.findById(id).exec();
    if (!r) throw new NotFoundException('Raffle not found');
    return r;
  }

  async incrementStats(
    raffleId: string,
    ticketsDelta: number,
    participantsDelta: number,
  ) {
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

    raffle.winnerTicketId = winner._id;
    raffle.winnerUserId = winner.userId;
    raffle.drawnAt = new Date();
    raffle.status = RaffleStatus.DRAWN;

    await raffle.save();

    await this.ticketModel
      .updateOne({ _id: winner._id }, { $set: { status: 'WINNER' } })
      .exec();

    return {
      raffleId: raffle._id.toString(),
      status: raffle.status,
      winnerTicketId: winner._id.toString(),
      winnerUserId: winner.userId.toString(),
      serial: winner.serial,
      drawnAt: raffle.drawnAt,
    };
  }

  // =======================
  // ✅ Admin Create (Product + Raffle en 1 requête)
  // =======================
  async adminCreateRaffle(dto: AdminCreateRaffleDto, createdBy: string) {
    const now = new Date();

    const publishNow = dto.publishNow !== false; // default true

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

    if (publishNow && endAt <= now) {
      throw new BadRequestException('endAt doit être dans le futur');
    }

    const session = await this.connection.startSession();
    session.startTransaction();

    try {
      // 1) Product
      const product = new this.productModel({
        title: dto.product.title,
        description: dto.product.description ?? '',
        imageUrl: dto.product.imageUrl,
        categoryId: dto.product.categoryId,
        realValue: dto.product.realValue ?? 0,
      });

      await product.save({ session });

      // 2) Raffle (aligné avec ton schema actuel)
      const rafflePayload: any = {
        productId: new Types.ObjectId(product._id),
        ticketPrice: dto.raffle.ticketPrice,
        currency: dto.raffle.currency ?? 'XAF',
        startAt,
        endAt,
        rules: dto.raffle.rules ?? '',
        status: publishNow ? RaffleStatus.LIVE : RaffleStatus.DRAFT,
        createdBy: new Types.ObjectId(createdBy),
      };

      // si ton schema a totalTickets/badge, on les met (sinon mongoose les ignore si strict)
      if (dto.raffle.totalTickets)
        rafflePayload.totalTickets = dto.raffle.totalTickets;
      if (dto.raffle.badge) rafflePayload.badge = dto.raffle.badge;

      const raffle = new this.raffleModel(rafflePayload);
      await raffle.save({ session });

      await session.commitTransaction();

      return {
        product,
        raffle,
      };
    } catch (e) {
      await session.abortTransaction();
      throw e;
    } finally {
      session.endSession();
    }
  }
}
