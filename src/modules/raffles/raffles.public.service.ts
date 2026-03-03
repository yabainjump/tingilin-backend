import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { Raffle } from './schemas/raffle.schema';
import { Product } from '../products/schemas/product.schema';

type RaffleLean = {
  _id: Types.ObjectId;
  status: string;
  ticketPrice: number;
  currency: string;
  startAt: Date;
  endAt: Date;
  rules?: string;
  ticketsSold?: number;
  participantsCount?: number;
  productId?: Types.ObjectId;
};

type ProductLean = {
  _id: Types.ObjectId;
  title: string;
  images?: string[];
  status: string;
};

@Injectable()
export class RafflesPublicService {
  constructor(
    @InjectModel(Raffle.name) private readonly raffleModel: Model<Raffle>,
    @InjectModel(Product.name) private readonly productModel: Model<Product>,
  ) {}

  private asObjectId(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid id');
    }
    return new Types.ObjectId(id);
  }

  async listLive() {
    const now = new Date();

    const raffles = await this.raffleModel
      .find({
        status: 'LIVE',
        startAt: { $lte: now },
        endAt: { $gt: now },
      })
      .sort({ endAt: 1 })
      .limit(50)
      .lean<RaffleLean[]>()
      .exec();

    const productIds = raffles
      .map((r) => r.productId)
      .filter((x): x is Types.ObjectId => !!x);

    const products = await this.productModel
      .find({ _id: { $in: productIds }, status: 'PUBLISHED' })
      .select({ title: 1, images: 1, status: 1 })
      .lean<ProductLean[]>()
      .exec();

    const productMap = new Map<string, ProductLean>(
      products.map((p) => [p._id.toString(), p]),
    );

    return raffles.map((r) => {
      const endAtMs = r.endAt ? new Date(r.endAt).getTime() : null;
      const remainingMs = endAtMs ? Math.max(0, endAtMs - Date.now()) : null;

      return {
        _id: r._id.toString(),
        status: r.status,
        ticketPrice: r.ticketPrice,
        currency: r.currency,
        startAt: r.startAt,
        endAt: r.endAt,
        remainingMs,
        rules: r.rules,
        ticketsSold: r.ticketsSold ?? 0,
        participantsCount: r.participantsCount ?? 0,
        product: r.productId
          ? (productMap.get(r.productId.toString()) ?? null)
          : null,
      };
    });
  }

  async getOne(id: string) {
    const _id = this.asObjectId(id);

    const raffle: any = await this.raffleModel.findById(_id).lean().exec();
    if (!raffle) throw new NotFoundException('Raffle not found');

    const product: any = raffle.productId
      ? await this.productModel
          .findById(raffle.productId)
          .select({ title: 1, images: 1, status: 1 })
          .lean()
          .exec()
      : null;
    const endAtMs = raffle.endAt ? new Date(raffle.endAt).getTime() : null;
    const remainingMs = endAtMs ? Math.max(0, endAtMs - Date.now()) : null;

    return {
      _id: raffle._id.toString(),
      status: raffle.status,
      ticketPrice: raffle.ticketPrice,
      currency: raffle.currency,
      startAt: raffle.startAt,
      endAt: raffle.endAt,
      remainingMs,
      rules: raffle.rules,
      ticketsSold: raffle.ticketsSold ?? 0,
      participantsCount: raffle.participantsCount ?? 0,
      product: product ? { ...product, _id: product._id.toString() } : null,
    };
  }

  async getStats(id: string) {
    const _id = this.asObjectId(id);

    const raffle: any = await this.raffleModel
      .findById(_id)
      .select({ status: 1, ticketsSold: 1, participantsCount: 1, endAt: 1 })
      .lean()
      .exec();

    if (!raffle) throw new NotFoundException('Raffle not found');

    const endAtMs = raffle.endAt ? new Date(raffle.endAt).getTime() : null;
    const remainingMs = endAtMs ? Math.max(0, endAtMs - Date.now()) : null;

    return {
      raffleId: raffle._id.toString(),
      status: raffle.status,
      ticketsSold: raffle.ticketsSold ?? 0,
      participantsCount: raffle.participantsCount ?? 0,
      endAt: raffle.endAt ?? null,
      remainingMs,
    };
  }

  async getWinner(id: string) {
    const _id = this.asObjectId(id);

    const raffle: any = await this.raffleModel.findById(_id).lean().exec();
    if (!raffle) throw new NotFoundException('Raffle not found');

    const product: any = raffle.productId
      ? await this.productModel
          .findById(raffle.productId)
          .select({ title: 1, images: 1, status: 1 })
          .lean()
          .exec()
      : null;

    const isDrawn = raffle.status === 'DRAWN';

    const serial = raffle.serial ?? raffle.winnerSerial ?? null;
    const drawnAt = raffle.drawnAt ?? null;

    const winner = isDrawn
      ? {
          ticketId: raffle.winnerTicketId ?? null,
          userId: raffle.winnerUserId ?? null,
          serial,
          drawnAt,
        }
      : null;

    return {
      raffleId: raffle._id.toString(),
      status: raffle.status,
      product: product ? { ...product, _id: product._id.toString() } : null,
      winner,
    };
  }
}
