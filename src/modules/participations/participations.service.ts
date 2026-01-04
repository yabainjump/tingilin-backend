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

    // upsert + incrément totalTicketsBought
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

    // Si upsert a créé un doc → nouveau participant
    const wasCreated = (res as any).upsertedCount
      ? (res as any).upsertedCount > 0
      : !!(res as any).upsertedId;
    return { wasCreated };
  }
}
