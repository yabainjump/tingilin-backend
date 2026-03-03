import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
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
  }) {
    const raffleObj = new Types.ObjectId(params.raffleId);
    const userObj = new Types.ObjectId(params.userId);
    const txObj = new Types.ObjectId(params.transactionId);

    const docs = Array.from({ length: params.quantity }).map(() => ({
      raffleId: raffleObj,
      userId: userObj,
      transactionId: txObj,
      serial: this.generateSerial(params.raffleId),
      status: 'ACTIVE' as const,
    }));

    try {
      return await this.ticketModel.insertMany(docs, { ordered: false });
    } catch {

      const retryDocs = docs.map((d) => ({
        ...d,
        serial: this.generateSerial(params.raffleId),
      }));
      return await this.ticketModel.insertMany(retryDocs, { ordered: false });
    }
  }

  private generateSerial(raffleId: string) {
    const rand = Math.random().toString(16).slice(2, 10).toUpperCase();
    return `TGL-${raffleId.slice(-6).toUpperCase()}-${rand}`;
  }
}
