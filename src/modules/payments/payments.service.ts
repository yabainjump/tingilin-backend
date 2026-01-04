import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { RafflesService } from '../raffles/raffles.service';
import { TicketsService } from '../tickets/tickets.service';
import { CreateIntentDto } from './dto/create-intent.dto';
import { MockConfirmDto } from './dto/mock-confirm.dto';
import { Transaction, TransactionDocument } from './schemas/transaction.schema';
import { ParticipationsService } from '../participations/participations.service';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectModel(Transaction.name)
    private readonly txModel: Model<TransactionDocument>,
    private readonly rafflesService: RafflesService,
    private readonly ticketsService: TicketsService,
    private readonly participationsService: ParticipationsService,
  ) {}

  async createIntent(userId: string, dto: CreateIntentDto) {
    // Vérifier tombola
    const raffle = await this.rafflesService.adminGetById(dto.raffleId); // adminGetById = existe même si pas public
    if (raffle.status !== 'LIVE')
      throw new BadRequestException('Raffle is not LIVE');

    const amount = dto.quantity * raffle.ticketPrice;

    const tx = await this.txModel.create({
      userId: new Types.ObjectId(userId),
      raffleId: new Types.ObjectId(dto.raffleId),
      quantity: dto.quantity,
      amount,
      currency: raffle.currency,
      provider: dto.provider ?? 'MOCK',
      status: 'PENDING',
    });

    return {
      transactionId: tx._id.toString(),
      provider: tx.provider,
      amount: tx.amount,
      currency: tx.currency,
      status: tx.status,
    };
  }

  // DEV: Confirmer transaction et générer tickets
  async mockConfirm(userId: string, dto: MockConfirmDto) {
    const tx = await this.txModel.findById(dto.transactionId).exec();
    if (!tx) throw new NotFoundException('Transaction not found');
    if (tx.userId.toString() !== userId)
      throw new BadRequestException('Not your transaction');

    // ✅ Idempotency
    if (tx.status === 'SUCCESS') {
      return {
        ok: true,
        transactionId: tx._id.toString(),
        status: tx.status,
        idempotent: true,
      };
    }
    if (tx.status !== 'PENDING')
      throw new BadRequestException('Transaction not pending');

    // ✅ Empêcher providerRef dupliqué (recommandé)
    const refUsed = await this.txModel.exists({
      provider: tx.provider,
      providerRef: dto.providerRef,
      _id: { $ne: tx._id },
    });
    if (refUsed) throw new BadRequestException('providerRef already used');

    tx.status = 'SUCCESS';
    tx.providerRef = dto.providerRef;
    tx.confirmedAt = new Date();
    await tx.save();

    // Générer tickets
    await this.ticketsService.createMany({
      raffleId: tx.raffleId.toString(),
      userId: tx.userId.toString(),
      transactionId: tx._id.toString(),
      quantity: tx.quantity,
    });

    const part = await this.participationsService.upsertAfterPurchase({
      raffleId: tx.raffleId.toString(),
      userId: tx.userId.toString(),
      quantity: tx.quantity,
    });

    // ticketsSold toujours +quantity
    // participantsCount +1 uniquement si nouveau participant
    await this.rafflesService.incrementStats(
      tx.raffleId.toString(),
      tx.quantity,
      part.wasCreated ? 1 : 0,
    );

    
    return { ok: true, transactionId: tx._id.toString(), status: tx.status };
  }

  private async bumpRaffleStats(
    raffleId: string,
    userId: string,
    quantity: number,
  ) {
    // On incrémente ticketsSold; participantsCount = distinct users (approche simple: increment si premier achat)
    // Pour rester simple dans cette étape, on ne calcule pas distinct; on incrémente participantsCount de 1 si quantity > 0
    // (On améliorera en “distinct” à l’étape suivante avec une collection de participation).
    await this.rafflesService.adminUpdate(raffleId, {}); // garde la validation
    const { default: mongoose } = await import('mongoose');
    const RaffleModel = mongoose.model('Raffle');
    await RaffleModel.updateOne(
      { _id: raffleId },
      { $inc: { ticketsSold: quantity, participantsCount: 1 } },
    ).exec();
  }
}
