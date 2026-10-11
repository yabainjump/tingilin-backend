import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { BadRequestException } from '@nestjs/common';
import { ClientSession, Model, Types } from 'mongoose';
import {
  Participation,
  ParticipationDocument,
} from './schemas/participation.schema';
import { Ticket, TicketDocument } from '../tickets/schemas/ticket.schema';

@Injectable()
export class ParticipationsService {
  constructor(
    @InjectModel(Participation.name)
    private readonly model: Model<ParticipationDocument>,
    @InjectModel(Ticket.name)
    private readonly ticketModel: Model<TicketDocument>,
  ) {}

  async upsertAfterPurchase(params: {
    raffleId: string;
    userId: string;
    quantity: number;
  }, session?: ClientSession) {
    const raffleObj = new Types.ObjectId(params.raffleId);
    const userObj = new Types.ObjectId(params.userId);

    const current = await this.model
      .findOne({ raffleId: raffleObj, userId: userObj })
      .session(session ?? null)
      .exec();
    const already = Number(current?.totalTicketsBought ?? 0);
    if (already + params.quantity > 200) {
      throw new BadRequestException(
        'Ticket limit reached for this raffle (max 200)',
      );
    }

    const res = await this.model
      .updateOne(
        { raffleId: raffleObj, userId: userObj },
        {
          $setOnInsert: { firstPurchaseAt: new Date() },
          $inc: { totalTicketsBought: params.quantity },
        },
        { upsert: true, session },
      )
      .exec();

    const wasCreated = (res as any).upsertedCount
      ? (res as any).upsertedCount > 0
      : !!(res as any).upsertedId;
    return { wasCreated };
  }

  /**
   * Vue agrerge "mes participations": un seul aller-retour Mongo remplace
   * l'ancien flux (1 requete tickets + 1 requete detail PAR raffle cote client).
   * A 2000 utilisateurs ouverts simultanement sur cette page, on passe d'environ
   * 42 000 requetes a 2000 pour un cache froid.
   */
  async myOverview(userId: string) {
    const userObj = new Types.ObjectId(userId);
    const rows: any[] = await this.ticketModel
      .aggregate([
        { $match: { userId: userObj } },
        {
          $group: {
            _id: '$raffleId',
            ticketsCount: { $sum: 1 },
            firstSerial: { $first: '$serial' },
            lastTicketAt: { $max: '$createdAt' },
          },
        },
        { $sort: { lastTicketAt: -1 } },
        { $limit: 200 },
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
            _id: 0,
            raffleId: { $toString: '$_id' },
            ticketsCount: 1,
            firstSerial: 1,
            lastTicketAt: 1,
            raffle: {
              $cond: [
                { $ifNull: ['$raffle._id', false] },
                {
                  id: { $toString: '$raffle._id' },
                  title: { $ifNull: ['$product.title', '—'] },
                  description: { $ifNull: ['$product.description', ''] },
                  imageUrl: { $ifNull: ['$product.imageUrl', ''] },
                  ticketPrice: '$raffle.ticketPrice',
                  currency: { $ifNull: ['$raffle.currency', 'XAF'] },
                  sold: { $ifNull: ['$raffle.ticketsSold', 0] },
                  total: { $ifNull: ['$raffle.totalTickets', 0] },
                  status: '$raffle.status',
                  startAt: '$raffle.startAt',
                  endAt: '$raffle.endAt',
                  endsAt: '$raffle.endAt',
                },
                null,
              ],
            },
          },
        },
      ])
      .exec();

    return { data: rows };
  }

  async getOrCreate(raffleId: string, userId: string) {    const raffleObj = new Types.ObjectId(raffleId);
    const userObj = new Types.ObjectId(userId);

    const doc = await this.model
      .findOneAndUpdate(
        { raffleId: raffleObj, userId: userObj },
        {
          $setOnInsert: {
            firstPurchaseAt: new Date(),
            totalTicketsBought: 0,
            failedAttempts: 0,
          },
        },
        { upsert: true, new: true },
      )
      .exec();

    return doc;
  }
}
