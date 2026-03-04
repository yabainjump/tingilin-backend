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
import { DigikuntzPaymentsService } from './providers/digikuntz-payments.service';
import { DigikuntzVerifyDto } from './dto/digikuntz-verify.dto';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class PaymentsService {
  constructor(
    @InjectModel(Transaction.name)
    private readonly txModel: Model<TransactionDocument>,
    private readonly rafflesService: RafflesService,
    private readonly ticketsService: TicketsService,
    private readonly participationsService: ParticipationsService,
    private readonly digikuntz: DigikuntzPaymentsService,
    private readonly notifications: NotificationsService,
  ) {}

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

      const provider = dto.provider ?? 'MOCK';

      if (provider === 'DIGIKUNTZ') {
        if (
          !dto.userEmail ||
          !dto.userPhone ||
          !dto.userCountry ||
          !dto.senderName
        ) {
          throw new BadRequestException(
            'DIGIKUNTZ requires userEmail, userPhone, userCountry, senderName',
          );
        }

        const payin = await this.digikuntz.createPayin({
          amount: dto.amount,
          reason: `TINGILIN|${tx._id.toString()}|${dto.raffleId}|${userId}|qty:${quantity}`,
          userEmail: dto.userEmail,
          userPhone: dto.userPhone,
          userCountry: dto.userCountry,
          senderName: dto.senderName,
        });

        tx.provider = 'DIGIKUNTZ';
        tx.providerTransactionId = payin.id;
        tx.providerRef = payin.transactionRef;
        tx.paymentLink = payin.paymentLink;
        tx.paymentWithTaxes = Number(payin.paymentWithTaxes ?? 0);
        tx.rawProviderStatus = payin.status;
        await tx.save();

        return {
          transactionId: tx._id.toString(),
          provider: tx.provider,
          amount: tx.amount,
          currency: tx.currency,
          status: tx.status,
          quantity,
          ticketUnitPrice: unit,
          paymentLink: tx.paymentLink,
          paymentWithTaxes: tx.paymentWithTaxes,
        };
      }

      return {
        transactionId: tx._id.toString(),
        provider: tx.provider,
        amount: tx.amount,
        currency: tx.currency,
        status: tx.status,
        quantity,
        ticketUnitPrice: unit,
      };

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
    );
    parts.failedAttempts = 0;
    parts.blockedUntil = undefined;
    await parts.save();

    if (tx.status !== 'PENDING')
      throw new BadRequestException('Transaction not pending');

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
    const { default: mongoose } = await import('mongoose');
    const RaffleModel = mongoose.model('Raffle');
    await RaffleModel.updateOne(
      { _id: raffleId },
      { $inc: { ticketsSold: quantity, participantsCount: 1 } },
    ).exec();
  }

  async mockFail(userId: string, dto: MockFailDto) {
    const tx = await this.txModel.findById(dto.transactionId).exec();
    if (!tx) throw new NotFoundException('Transaction not found');
    if (tx.userId.toString() !== userId)
      throw new BadRequestException('Not your transaction');

    const part = await this.participationsService.getOrCreate(
      tx.raffleId.toString(),
      userId,
    );

    if (
      part.blockedUntil instanceof Date &&
      part.blockedUntil.getTime() > Date.now()
    ) {
      throw new BadRequestException(
        `Temporarily blocked due to failed payments until ${part.blockedUntil.toISOString()}`,
      );
    }

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

  async digikuntzVerify(userId: string, dto: DigikuntzVerifyDto) {
    const tx = await this.txModel.findById(dto.transactionId).exec();
    if (!tx) throw new NotFoundException('Transaction not found');
    if (tx.userId.toString() !== userId)
      throw new BadRequestException('Not your transaction');
    if (tx.provider !== 'DIGIKUNTZ')
      throw new BadRequestException('Not a DIGIKUNTZ transaction');

    
    if (tx.status === 'SUCCESS') {
      return {
        ok: true,
        transactionId: tx._id.toString(),
        status: tx.status,
        idempotent: true,
      };
    }

    if (tx.status !== 'PENDING') {
      return { ok: false, transactionId: tx._id.toString(), status: tx.status };
    }

    if (!tx.providerTransactionId) {
      throw new BadRequestException('Missing providerTransactionId');
    }

    const remote = await this.digikuntz.getTransaction(
      tx.providerTransactionId,
    );
    const remoteStatus = String(remote?.status ?? '').toLowerCase();
    tx.rawProviderStatus = remoteStatus;

    if (remoteStatus === 'pending') {
      await tx.save();
      return { ok: true, status: 'PENDING', remoteStatus };
    }

    if (remoteStatus === 'success') {
      tx.status = 'SUCCESS';
      tx.confirmedAt = new Date();
      await tx.save();

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

      await this.rafflesService.incrementStats(
        tx.raffleId.toString(),
        tx.quantity,
        part.wasCreated ? 1 : 0,
      );

      await this.notifications.create({
        userId: tx.userId.toString(),
        type: 'PAYMENT_SUCCESS',
        title: 'Paiement confirmé ✅',
        body: `Tes ${tx.quantity} ticket(s) ont été générés.`,
        data: {
          raffleId: tx.raffleId.toString(),
          transactionId: tx._id.toString(),
          deepLink: `/tabs/ticket-details/${tx.raffleId.toString()}`,
        },
      });

      return { ok: true, status: 'SUCCESS', transactionId: tx._id.toString() };
    }

    if (
      remoteStatus === 'closed' ||
      remoteStatus === 'error' ||
      remoteStatus.includes('error')
    ) {
      tx.status = 'FAILED';
      await tx.save();
      return { ok: false, status: 'FAILED', remoteStatus };
    }

    await tx.save();
    return { ok: true, status: tx.status, remoteStatus };
  }
}
