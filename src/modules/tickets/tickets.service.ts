import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
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
  }) {
    const raffleObj = new Types.ObjectId(params.raffleId);
    const userObj = new Types.ObjectId(params.userId);
    const txObj = new Types.ObjectId(params.transactionId);
    const quantity = Math.max(0, Math.floor(Number(params.quantity) || 0));

    // Idempotent ET tolerant aux collisions de serial: a chaque tour on
    // (re)compte ce qui est REELLEMENT en base pour cette transaction et on ne
    // cree que le manque. Avec l'index unique {raffleId,serial}, une collision en
    // mode ordered:false insere les non-collidants; on reboucle pour completer le
    // reste avec de nouveaux serials -> ni doublon (jamais plus que `quantity`),
    // ni manque. Couvre aussi le rejeu (webhook + verify).
    for (let attempt = 0; attempt < 5; attempt++) {
      const existingCount = await this.ticketModel
        .countDocuments({ transactionId: txObj })
        .exec();
      const remaining = quantity - existingCount;
      if (remaining <= 0) break;

      const docs = Array.from({ length: remaining }).map(() => ({
        raffleId: raffleObj,
        userId: userObj,
        transactionId: txObj,
        serial: this.generateSerial(params.raffleId),
        status: 'ACTIVE' as const,
      }));

      try {
        await this.ticketModel.insertMany(docs, { ordered: false });
        break;
      } catch (err: any) {
        // Seules les collisions de cle dupliquee sont rejouables.
        const isDup =
          Number(err?.code ?? 0) === 11000 || Array.isArray(err?.writeErrors);
        if (!isDup) throw err;
        // Certains docs se sont inseres: le prochain tour recompte et complete.
      }
    }

    return this.ticketModel.find({ transactionId: txObj }).exec();
  }

  private generateSerial(raffleId: string) {
    const rand = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `TGL-${raffleId.slice(-6).toUpperCase()}-${rand}`;
  }
}
