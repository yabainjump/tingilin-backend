import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import * as crypto from 'crypto';
import { Ticket, TicketDocument } from './schemas/ticket.schema';

@Injectable()
export class TicketsService {
  constructor(
    @InjectModel(Ticket.name)
    private readonly ticketModel: Model<TicketDocument>,
  ) {}

  async listMyTickets(userId: string, raffleId?: string) {
    const filter: any = { userId: new Types.ObjectId(userId) };
    if (raffleId) filter.raffleId = new Types.ObjectId(raffleId);

    return this.ticketModel.find(filter).sort({ createdAt: -1 }).exec();
  }

  async createMany(params: {
    raffleId: string;
    userId: string;
    transactionId: string;
    quantity: number;
  }, session?: ClientSession) {
    const raffleObj = new Types.ObjectId(params.raffleId);
    const userObj = new Types.ObjectId(params.userId);
    const txObj = new Types.ObjectId(params.transactionId);
    const quantity = Math.max(0, Math.floor(Number(params.quantity) || 0));

    if (quantity > 0) {
      await this.ticketModel.bulkWrite(
        Array.from({ length: quantity }, (_, sequence) => ({
          updateOne: {
            filter: { transactionId: txObj, sequence },
            update: {
              $setOnInsert: {
                raffleId: raffleObj,
                userId: userObj,
                transactionId: txObj,
                sequence,
                serial: this.generateSerial(params.raffleId),
                status: 'ACTIVE' as const,
              },
            },
            upsert: true,
          },
        })),
        { ordered: true, session },
      );
    }

    return this.ticketModel
      .find({ transactionId: txObj })
      .sort({ sequence: 1 })
      .session(session ?? null)
      .exec();
  }

  private generateSerial(raffleId: string) {
    const rand = crypto.randomBytes(8).toString('hex').toUpperCase();
    return `TGL-${raffleId.slice(-6).toUpperCase()}-${rand}`;
  }
}
