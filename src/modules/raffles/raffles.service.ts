import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ProductsService } from '../products/products.service';
import { CreateRaffleDto } from './dto/create-raffle.dto';
import { UpdateRaffleDto } from './dto/update-raffle.dto';
import { Raffle, RaffleDocument } from './schemas/raffle.schema';
import { Ticket, TicketDocument } from '../tickets/schemas/ticket.schema';

@Injectable()
export class RafflesService {
  constructor(
    @InjectModel(Raffle.name)
    private readonly raffleModel: Model<RaffleDocument>,
    @InjectModel(Ticket.name)
    private readonly ticketModel: Model<TicketDocument>,
    private readonly productsService: ProductsService,
  ) {}

  // Public
  async listPublic() {
    return this.raffleModel
      .find({ status: { $in: ['LIVE', 'CLOSED', 'DRAWN'] } })
      .sort({ createdAt: -1 })
      .exec();
  }

  // async getPublicById(id: string) {
  //   const r = await this.raffleModel
  //     .findOne({ _id: id, status: { $in: ['LIVE', 'CLOSED', 'DRAWN'] } })
  //     .exec();
  //   if (!r) throw new NotFoundException('Raffle not found');
  //   return r;
  // }

  async getPublicById(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid id');
    }

    try {
      const r = await this.raffleModel.findById(id).lean().exec();
      if (!r) throw new NotFoundException('Raffle not found');
      return r;
    } catch (e: any) {
      // sécurité anti CastError (au cas où)
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

  // Admin
  async adminCreate(dto: CreateRaffleDto, createdBy: string) {
    // Vérifier que le produit existe (adminGetById accepte tout status)
    await this.productsService.adminGetById(dto.productId);

    const startAt = new Date(dto.startAt);
    const endAt = new Date(dto.endAt);
    if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) {
      throw new BadRequestException('Invalid dates');
    }
    if (endAt <= startAt)
      throw new BadRequestException('endAt must be after startAt');

    return this.raffleModel.create({
      productId: new Types.ObjectId(dto.productId),
      ticketPrice: dto.ticketPrice,
      currency: dto.currency ?? 'XAF',
      startAt,
      endAt,
      rules: dto.rules ?? '',
      status: 'DRAFT',
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
    if (r.status !== 'DRAFT')
      throw new BadRequestException('Only DRAFT can be started');

    r.status = 'LIVE';
    return r.save();
  }

  async adminClose(id: string) {
    const r = await this.raffleModel.findById(id).exec();
    if (!r) throw new NotFoundException('Raffle not found');
    if (r.status !== 'LIVE')
      throw new BadRequestException('Only LIVE can be closed');

    r.status = 'CLOSED';
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

    if (raffle.status !== 'CLOSED') {
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

    // Tirage pondéré: chaque ticket = 1 entrée
    const idx = Math.floor(Math.random() * tickets.length);
    const winner = tickets[idx];

    raffle.winnerTicketId = winner._id;
    raffle.winnerUserId = winner.userId;
    raffle.drawnAt = new Date();
    raffle.status = 'DRAWN';

    await raffle.save();

    // Marquer le ticket gagnant
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
}
