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
import { MockFailDto } from './dto/mock-fail.dto';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectModel(Transaction.name)
    private readonly txModel: Model<TransactionDocument>,
    private readonly rafflesService: RafflesService,
    private readonly ticketsService: TicketsService,
    private readonly participationsService: ParticipationsService,
  ) {}

  // async createIntent(userId: string, dto: CreateIntentDto) {
  //   // 1) Vérifier tombola
  //   try {
  //     console.log('[createIntent] dto=', dto, 'userId=', userId);
  //     const raffle = await this.rafflesService.adminGetById(dto.raffleId);
  //     if (raffle.status !== 'LIVE')
  //       throw new BadRequestException('Raffle is not LIVE');
  //     console.log('[createIntent] raffle.status=', raffle?.status, 'ticketPrice=', raffle?.ticketPrice);

  //     // 2) Montant -> quantité (ticketPrice = 100)
  //     const unit = raffle.ticketPrice; // ex: 100
  //     if (!unit || unit <= 0)
  //       throw new BadRequestException('Invalid ticket price');

  //     if (dto.amount % unit !== 0) {
  //       throw new BadRequestException(`Amount must be a multiple of ${unit}`);
  //     }

  //     const quantity = dto.amount / unit;
  //     if (quantity <= 0) throw new BadRequestException('Invalid quantity');

  //     // 3) Vérifier blocage + quota user (200 max)
  //     const participation = await this.participationsService.getOrCreate(
  //       dto.raffleId,
  //       userId,
  //     );

  //     if (
  //       participation.blockedUntil instanceof Date &&
  //       participation.blockedUntil.getTime() > Date.now()
  //     ) {
  //       throw new BadRequestException(
  //         'Temporarily blocked due to failed payments',
  //       );
  //     }

  //     const MAX_TICKETS_PER_USER_PER_RAFFLE = 200;
  //     const already =
  //       typeof participation.totalTicketsBought === 'number'
  //         ? participation.totalTicketsBought
  //         : 0;

  //     if (already + quantity > MAX_TICKETS_PER_USER_PER_RAFFLE) {
  //       throw new BadRequestException(
  //         `Ticket limit reached for this raffle (max ${MAX_TICKETS_PER_USER_PER_RAFFLE})`,
  //       );
  //     }

  //     // 4) Créer transaction PENDING (amount est le montant réel, quantity calculée)
  //     const tx = await this.txModel.create({
  //       userId: new Types.ObjectId(userId),
  //       raffleId: new Types.ObjectId(dto.raffleId),
  //       quantity,
  //       amount: dto.amount,
  //       currency: raffle.currency,
  //       provider: dto.provider ?? 'MOCK',
  //       status: 'PENDING',
  //     });

  //     return {
  //       transactionId: tx._id.toString(),
  //       provider: tx.provider,
  //       amount: tx.amount,
  //       currency: tx.currency,
  //       status: tx.status,
  //       quantity, // ✅ utile côté frontend
  //       ticketUnitPrice: unit,
  //     };
  //   } catch (err) {
  //     console.error('createIntent error:', err);
  //     throw err; // on relance pour garder les bons status (400 etc.)
  //   }
  // }

  // DEV: Confirmer transaction et générer tickets

  async createIntent(userId: string, dto: CreateIntentDto) {
    try {
      console.log('[createIntent] dto=', dto, 'userId=', userId);

      const raffle = await this.rafflesService.adminGetById(dto.raffleId);
      console.log(
        '[createIntent] raffle.status=',
        raffle?.status,
        'ticketPrice=',
        raffle?.ticketPrice,
      );

      const unit = Number(raffle.ticketPrice);
      if (!Number.isFinite(unit) || unit <= 0) {
        throw new BadRequestException('Invalid ticket price');
      }

      const amount = Number(dto.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new BadRequestException('Invalid amount');
      }

      if (amount % unit !== 0) {
        throw new BadRequestException(`Amount must be a multiple of ${unit}`);
      }

      const quantity = amount / unit;

      const participation = await this.participationsService.getOrCreate(
        dto.raffleId,
        userId,
      );
      console.log('[createIntent] participation=', {
        totalTicketsBought: participation?.totalTicketsBought,
        blockedUntil: participation?.blockedUntil,
      });

      const blockedUntil =
        participation?.blockedUntil instanceof Date
          ? participation.blockedUntil
          : null;
      if (blockedUntil && blockedUntil.getTime() > Date.now()) {
        throw new BadRequestException(
          'Temporarily blocked due to failed payments',
        );
      }

      const already =
        typeof participation?.totalTicketsBought === 'number'
          ? participation.totalTicketsBought
          : 0;

      const MAX = 200;
      if (already + quantity > MAX) {
        throw new BadRequestException(
          `Ticket limit reached for this raffle (max ${MAX})`,
        );
      }

      const tx = await this.txModel.create({
        userId: new Types.ObjectId(userId),
        raffleId: new Types.ObjectId(dto.raffleId),
        quantity,
        amount,
        currency: raffle.currency ?? 'XAF',
        provider: dto.provider ?? 'MOCK',
        status: 'PENDING',
      });

      console.log('[createIntent] tx created=', tx._id.toString());

      return {
        transactionId: tx._id.toString(),
        provider: tx.provider,
        amount: tx.amount,
        currency: tx.currency,
        status: tx.status,
        quantity,
        ticketUnitPrice: unit,
      };
    } catch (err) {
      console.error('[createIntent] ERROR:', err);
      throw err;
    }
  }

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

    const partReset = await this.participationsService.getOrCreate(
      tx.raffleId.toString(),
      userId,
    );
    partReset.failedAttempts = 0;
    partReset.blockedUntil = undefined;
    await partReset.save();

    const parts = await this.participationsService.getOrCreate(
      tx.raffleId.toString(),
      userId,
      //test
    );
    parts.failedAttempts = 0;
    parts.blockedUntil = undefined;
    await parts.save();

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

    const partBefore = await this.participationsService.getOrCreate(
      tx.raffleId.toString(),
      userId,
    );
    const already =
      typeof partBefore.totalTicketsBought === 'number'
        ? partBefore.totalTicketsBought
        : 0;

    const MAX = 200;
    if (already + tx.quantity > MAX) {
      throw new BadRequestException(
        `Ticket limit reached for this raffle (max ${MAX})`,
      );
    }

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

  // async mockFail(userId: string, dto: MockFailDto) {
  //   const tx = await this.txModel.findById(dto.transactionId).exec();
  //   if (!tx) throw new NotFoundException('Transaction not found');
  //   if (tx.userId.toString() !== userId)
  //     throw new BadRequestException('Not your transaction');

  //   if (tx.status === 'SUCCESS') {
  //     // idempotent : on ne "fail" pas une transaction réussie
  //     return {
  //       ok: true,
  //       transactionId: tx._id.toString(),
  //       status: tx.status,
  //       idempotent: true,
  //     };
  //   }
  //   if (tx.status !== 'PENDING') {
  //     return {
  //       ok: true,
  //       transactionId: tx._id.toString(),
  //       status: tx.status,
  //       idempotent: true,
  //     };
  //   }

  //   tx.status = 'FAILED';
  //   tx.failReason = dto.reason; // si ce champ existe dans ton schema
  //   tx.failedAt = new Date(); // idem
  //   await tx.save();

  //   const part = await this.participationsService.getOrCreate(
  //     tx.raffleId.toString(),
  //     userId,
  //   );

  //   const currentFails =
  //     typeof part.failedAttempts === 'number' ? part.failedAttempts : 0;
  //   part.failedAttempts = currentFails + 1;

  //   // blocage après 3 échecs
  //   const MAX_FAILS = 3;
  //   const BLOCK_MINUTES = 10;

  //   if (part.failedAttempts >= MAX_FAILS) {
  //     part.blockedUntil = new Date(Date.now() + BLOCK_MINUTES * 60 * 1000);
  //   }

  //   await part.save();

  //   return {
  //     ok: true,
  //     transactionId: tx._id.toString(),
  //     status: tx.status,
  //     failedAttempts: part.failedAttempts,
  //     blockedUntil: part.blockedUntil ?? null,
  //   };
  // }

  async mockFail(userId: string, dto: MockFailDto) {
    const tx = await this.txModel.findById(dto.transactionId).exec();
    if (!tx) throw new NotFoundException('Transaction not found');
    if (tx.userId.toString() !== userId)
      throw new BadRequestException('Not your transaction');

    const part = await this.participationsService.getOrCreate(
      tx.raffleId.toString(),
      userId,
    );

    // si déjà bloqué, on refuse immédiatement (niveau 2)
    if (
      part.blockedUntil instanceof Date &&
      part.blockedUntil.getTime() > Date.now()
    ) {
      throw new BadRequestException(
        `Temporarily blocked due to failed payments until ${part.blockedUntil.toISOString()}`,
      );
    }

    // idempotence: si déjà terminal, ne pas ré-incrémenter
    if (tx.status === 'SUCCESS' || tx.status === 'FAILED') {
      return {
        ok: true,
        transactionId: tx._id.toString(),
        status: tx.status,
        idempotent: true,
      };
    }

    if (tx.status !== 'PENDING') {
      return {
        ok: true,
        transactionId: tx._id.toString(),
        status: tx.status,
        idempotent: true,
      };
    }

    tx.status = 'FAILED';
    tx.failReason = dto.reason;
    tx.failedAt = new Date();
    await tx.save();

    const currentFails =
      typeof part.failedAttempts === 'number' ? part.failedAttempts : 0;
    part.failedAttempts = currentFails + 1;

    const MAX_FAILS = 3;
    const BLOCK_MINUTES = 10;

    if (part.failedAttempts >= MAX_FAILS) {
      part.blockedUntil = new Date(Date.now() + BLOCK_MINUTES * 60 * 1000);
    }

    await part.save();

    return {
      ok: true,
      transactionId: tx._id.toString(),
      status: tx.status,
      failedAttempts: part.failedAttempts,
      blockedUntil: part.blockedUntil ?? null,
    };
  }
}
