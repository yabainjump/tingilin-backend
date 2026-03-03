import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  Participation,
  ParticipationDocument,
} from './schemas/participation.schema';

@Injectable()
export class ParticipationsService {
  constructor(
    @InjectModel(Participation.name)
    private readonly model: Model<ParticipationDocument>,
  ) {}

  async upsertAfterPurchase(params: {
    raffleId: string;
    userId: string;
    quantity: number;
  }) {
    const raffleObj = new Types.ObjectId(params.raffleId);
    const userObj = new Types.ObjectId(params.userId);

    const res = await this.model
      .updateOne(
        { raffleId: raffleObj, userId: userObj },
        {
          $setOnInsert: { firstPurchaseAt: new Date() },
          $inc: { totalTicketsBought: params.quantity },
        },
        { upsert: true },
      )
      .exec();

    const wasCreated = (res as any).upsertedCount
      ? (res as any).upsertedCount > 0
      : !!(res as any).upsertedId;
    return { wasCreated };
  }

  async getOrCreate(raffleId: string, userId: string) {
    const raffleObj = new Types.ObjectId(raffleId);
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
