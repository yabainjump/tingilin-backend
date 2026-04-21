import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as crypto from 'crypto';
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
import { RaffleStatus } from '../raffles/schemas/raffle.schema';
import { UsersService } from '../users/users.service';
import { CreateFreeTicketDto } from './dto/create-free-ticket.dto';
import { LedgerEntry, LedgerEntryDocument } from './schemas/ledger-entry.schema';
import {
  getRequiredSecret,
  getWebhookSignatureMode,
  isProductionEnv,
  parseBooleanFlag,
} from '../../common/config/runtime-security';

type DashboardGranularity = 'DAY' | 'MONTH' | 'YEAR';

interface DashboardRange {
  from: Date;
  to: Date;
  previousFrom: Date;
  previousTo: Date;
  bucketFormat: string;
  label: string;
}

interface DashboardKpiSnapshot {
  ticketsSold: number;
  cashIn: number;
  netCashIn: number;
  transactions: number;
  successRate: number;
  averageBasket: number;
}

@Injectable()
export class PaymentsService {
  private readonly analyticsTimezone = 'Africa/Douala';

  constructor(
    @InjectModel(Transaction.name)
    private readonly txModel: Model<TransactionDocument>,
    @InjectModel(LedgerEntry.name)
    private readonly ledgerModel: Model<LedgerEntryDocument>,
    private readonly rafflesService: RafflesService,
    private readonly ticketsService: TicketsService,
    private readonly participationsService: ParticipationsService,
    private readonly digikuntz: DigikuntzPaymentsService,
    private readonly notifications: NotificationsService,
    private readonly usersService: UsersService,
    private readonly config: ConfigService,
  ) {}

  mockPaymentsEnabled(): boolean {
    const explicit = this.config.get<string>('ENABLE_MOCK_PAYMENTS');
    if (String(explicit ?? '').trim()) {
      return parseBooleanFlag(explicit, false);
    }

    return !isProductionEnv(this.config.get<string>('NODE_ENV', 'development'));
  }

  private parseDashboardGranularity(raw?: string): DashboardGranularity {
    const value = String(raw ?? 'DAY').trim().toUpperCase();
    if (value === 'MONTH') return 'MONTH';
    if (value === 'YEAR') return 'YEAR';
    return 'DAY';
  }

  private dashboardBucketFormat(granularity: DashboardGranularity): string {
    if (granularity === 'YEAR') return '%Y';
    if (granularity === 'MONTH') return '%Y-%m';
    return '%Y-%m-%d %H';
  }

  private parseDashboardDateInput(raw: string, fieldName: 'dateFrom' | 'dateTo'): Date {
    const parsed = new Date(String(raw ?? '').trim());
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`Invalid ${fieldName}`);
    }
    return parsed;
  }

  private buildCustomRangeLabel(
    granularity: DashboardGranularity,
    from: Date,
    to: Date,
  ): string {
    if (granularity === 'YEAR') {
      const yearFormatter = new Intl.DateTimeFormat('fr-FR', {
        timeZone: this.analyticsTimezone,
        year: 'numeric',
      });
      return `${yearFormatter.format(from)} -> ${yearFormatter.format(to)}`;
    }

    if (granularity === 'MONTH') {
      const monthFormatter = new Intl.DateTimeFormat('fr-FR', {
        timeZone: this.analyticsTimezone,
        month: '2-digit',
        year: 'numeric',
      });
      return `${monthFormatter.format(from)} -> ${monthFormatter.format(to)}`;
    }

    const dateTimeFormatter = new Intl.DateTimeFormat('fr-FR', {
      timeZone: this.analyticsTimezone,
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return `${dateTimeFormatter.format(from)} -> ${dateTimeFormatter.format(to)}`;
  }

  private buildDashboardRange(
    granularity: DashboardGranularity,
    dateFromRaw?: string,
    dateToRaw?: string,
  ): DashboardRange {
    const now = new Date();
    const customFromRaw = String(dateFromRaw ?? '').trim();
    const customToRaw = String(dateToRaw ?? '').trim();
    const hasCustomFrom = customFromRaw.length > 0;
    const hasCustomTo = customToRaw.length > 0;

    if (hasCustomFrom !== hasCustomTo) {
      throw new BadRequestException('dateFrom and dateTo must be provided together');
    }

    if (hasCustomFrom && hasCustomTo) {
      const from = this.parseDashboardDateInput(customFromRaw, 'dateFrom');
      const to = this.parseDashboardDateInput(customToRaw, 'dateTo');

      if (from.getTime() > to.getTime()) {
        throw new BadRequestException('dateFrom must be less than or equal to dateTo');
      }

      const durationMs = to.getTime() - from.getTime() + 1;
      const previousTo = new Date(from.getTime() - 1);
      const previousFrom = new Date(previousTo.getTime() - durationMs + 1);

      return {
        from,
        to,
        previousFrom,
        previousTo,
        bucketFormat: this.dashboardBucketFormat(granularity),
        label: this.buildCustomRangeLabel(granularity, from, to),
      };
    }

    if (granularity === 'MONTH') {
      const to = now;
      const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      from.setUTCMonth(from.getUTCMonth() - 11);

      const previousTo = new Date(from.getTime() - 1);
      const previousFrom = new Date(from);
      previousFrom.setUTCMonth(previousFrom.getUTCMonth() - 12);

      return {
        from,
        to,
        previousFrom,
        previousTo,
        bucketFormat: this.dashboardBucketFormat(granularity),
        label: '12 derniers mois',
      };
    }

    if (granularity === 'YEAR') {
      const to = now;
      const from = new Date(Date.UTC(now.getUTCFullYear() - 4, 0, 1));

      const previousTo = new Date(from.getTime() - 1);
      const previousFrom = new Date(Date.UTC(from.getUTCFullYear() - 5, 0, 1));

      return {
        from,
        to,
        previousFrom,
        previousTo,
        bucketFormat: this.dashboardBucketFormat(granularity),
        label: '5 dernieres annees',
      };
    }

    const to = now;
    const from = new Date(now.getTime() - 23 * 60 * 60 * 1000);

    const previousTo = new Date(from.getTime() - 1);
    const previousFrom = new Date(previousTo.getTime() - (to.getTime() - from.getTime()));

    return {
      from,
      to,
      previousFrom,
      previousTo,
      bucketFormat: this.dashboardBucketFormat(granularity),
      label: '24 dernieres heures',
    };
  }

  private deltaPercent(current: number, previous: number): number {
    const curr = Number(current ?? 0);
    const prev = Number(previous ?? 0);

    if (prev === 0) {
      return curr > 0 ? 100 : 0;
    }

    return Number((((curr - prev) / prev) * 100).toFixed(1));
  }

  private rate(success: number, total: number): number {
    const ok = Number(success ?? 0);
    const all = Number(total ?? 0);
    if (all <= 0) return 0;
    return Number(((ok / all) * 100).toFixed(1));
  }

  private xafCondition(status: 'SUCCESS' | 'REFUNDED') {
    return {
      $and: [
        { $eq: ['$status', status] },
        {
          $in: [
            { $toUpper: { $ifNull: ['$currency', 'XAF'] } },
            ['XAF', 'XOF'],
          ],
        },
      ],
    };
  }

  private getDatePartsInTimezone(date: Date): {
    year: string;
    month: string;
    day: string;
    hour: string;
  } {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: this.analyticsTimezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(date);

    const year = parts.find((p) => p.type === 'year')?.value ?? '0000';
    const month = parts.find((p) => p.type === 'month')?.value ?? '01';
    const day = parts.find((p) => p.type === 'day')?.value ?? '01';
    const hour = parts.find((p) => p.type === 'hour')?.value ?? '00';

    return { year, month, day, hour };
  }

  private toBucketKey(date: Date, granularity: DashboardGranularity): string {
    const parts = this.getDatePartsInTimezone(date);
    if (granularity === 'YEAR') {
      return parts.year;
    }
    if (granularity === 'MONTH') {
      return `${parts.year}-${parts.month}`;
    }
    return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}`;
  }

  private toBucketLabel(key: string, granularity: DashboardGranularity): string {
    if (granularity === 'YEAR') {
      return key;
    }
    if (granularity === 'MONTH') {
      const [year, month] = key.split('-');
      return `${month}/${year}`;
    }

    const [datePart = '', hourPart = '00'] = key.split(' ');
    const [year, month, day] = datePart.split('-');
    const hour = String(hourPart ?? '00').slice(0, 2);
    return `${day}/${month}/${year?.slice(-2)} ${hour}h`;
  }

  private buildBucketKeys(
    granularity: DashboardGranularity,
    from: Date,
    to: Date,
  ): string[] {
    const keys: string[] = [];
    const cursor = new Date(from);

    while (cursor.getTime() <= to.getTime()) {
      keys.push(this.toBucketKey(cursor, granularity));

      if (granularity === 'YEAR') {
        cursor.setUTCFullYear(cursor.getUTCFullYear() + 1);
      } else if (granularity === 'MONTH') {
        cursor.setUTCMonth(cursor.getUTCMonth() + 1);
      } else {
        cursor.setUTCHours(cursor.getUTCHours() + 1);
      }
    }

    return Array.from(new Set(keys));
  }

  private async aggregateDashboardKpis(
    from: Date,
    to: Date,
  ): Promise<DashboardKpiSnapshot> {
    const [result] = await this.txModel
      .aggregate([
        { $match: { createdAt: { $gte: from, $lte: to } } },
        {
          $group: {
            _id: null,
            transactions: { $sum: 1 },
            successCount: {
              $sum: { $cond: [{ $eq: ['$status', 'SUCCESS'] }, 1, 0] },
            },
            ticketsSold: {
              $sum: { $cond: [{ $eq: ['$status', 'SUCCESS'] }, '$quantity', 0] },
            },
            cashIn: {
              $sum: { $cond: [this.xafCondition('SUCCESS'), '$amount', 0] },
            },
            refunded: {
              $sum: { $cond: [this.xafCondition('REFUNDED'), '$amount', 0] },
            },
          },
        },
      ])
      .exec();

    const transactions = Number(result?.transactions ?? 0);
    const successCount = Number(result?.successCount ?? 0);
    const ticketsSold = Number(result?.ticketsSold ?? 0);
    const cashIn = Number(result?.cashIn ?? 0);
    const refunded = Number(result?.refunded ?? 0);
    const netCashIn = cashIn - refunded;
    const averageBasket =
      successCount > 0 ? Number((cashIn / successCount).toFixed(1)) : 0;

    return {
      ticketsSold,
      cashIn,
      netCashIn,
      transactions,
      successRate: this.rate(successCount, transactions),
      averageBasket,
    };
  }

  private async notifyPaymentFailed(tx: TransactionDocument, reason?: string) {
    const transactionId = tx._id.toString();
    const raffleId = tx.raffleId.toString();
    const cleanReason = String(reason ?? '').trim();

    await this.notifications.createOnce({
      userId: tx.userId.toString(),
      type: 'PAYMENT_FAILED',
      title: 'Paiement échoué',
      body: cleanReason
        ? `Paiement échoué (${cleanReason}). Appuie pour réessayer.`
        : 'Le paiement n’a pas abouti. Appuie pour réessayer.',
      dedupeKey: `payment-failed:${transactionId}`,
      data: {
        raffleId,
        transactionId,
        deepLink: `/tabs/raffle-details/${raffleId}`,
      },
    });
  }

  private assertRafflePurchasable(raffle: any) {
    const now = Date.now();
    const startAt = raffle?.startAt ? new Date(raffle.startAt).getTime() : NaN;
    const endAt = raffle?.endAt ? new Date(raffle.endAt).getTime() : NaN;

    if (raffle.status !== RaffleStatus.LIVE) {
      throw new BadRequestException('Raffle is closed');
    }
    if (Number.isFinite(startAt) && startAt > now) {
      throw new BadRequestException('Raffle has not started yet');
    }
    if (Number.isFinite(endAt) && endAt <= now) {
      throw new BadRequestException('Raffle has ended');
    }

    const totalTickets = Number(raffle?.totalTickets ?? 0);
    const soldTickets = Number(raffle?.ticketsSold ?? 0);
    if (totalTickets > 0 && soldTickets >= totalTickets) {
      throw new BadRequestException('No tickets left for this raffle');
    }
  }

  private normalizeIdempotencyKey(input?: string): string | null {
    const value = String(input ?? '').trim();
    if (!value) return null;
    return value.toLowerCase();
  }

  private firstNonEmpty(...values: Array<string | null | undefined>): string {
    for (const value of values) {
      const normalized = String(value ?? '').trim();
      if (
        normalized &&
        normalized.toLowerCase() !== 'null' &&
        normalized.toLowerCase() !== 'undefined'
      ) {
        return normalized;
      }
    }
    return '';
  }

  private normalizePhone(input?: string | null): string {
    return String(input ?? '').replace(/\s|-/g, '').trim();
  }

  private rethrowPersistenceError(error: any): never {
    const code = Number(error?.code ?? 0);
    const message = String(error?.message ?? '').trim();

    if (code === 11000) {
      const keyPattern = error?.keyPattern ?? {};
      const conflictKeys = Object.keys(keyPattern).filter(Boolean);
      const conflictHint = conflictKeys.length
        ? ` (${conflictKeys.join(', ')})`
        : '';

      if (
        conflictKeys.includes('idempotencyKey') ||
        /idempotencyKey/i.test(message)
      ) {
        throw new ConflictException(
          `Duplicate payment request detected${conflictHint}. Please wait a few seconds and retry.`,
        );
      }

      throw new ConflictException(
        `Duplicate payment reference detected${conflictHint}. Please retry in a few seconds.`,
      );
    }

    if (/validation failed/i.test(message)) {
      throw new BadRequestException(`Invalid payment payload: ${message}`);
    }

    throw error;
  }

  private isDuplicateKeyError(error: any, fieldName?: string): boolean {
    const code = Number(error?.code ?? 0);
    if (code !== 11000) {
      return false;
    }

    if (!fieldName) {
      return true;
    }

    const keyPattern = error?.keyPattern ?? {};
    const message = String(error?.message ?? '');
    return Boolean(keyPattern?.[fieldName]) || new RegExp(fieldName, 'i').test(message);
  }

  private buildIntentResponse(tx: any, ticketUnitPrice: number, idempotent = false) {
    return {
      transactionId: tx._id.toString(),
      provider: tx.provider,
      amount: tx.amount,
      currency: tx.currency,
      status: tx.status,
      quantity: Number(tx.quantity ?? 0),
      ticketUnitPrice,
      paymentLink: tx.paymentLink ?? undefined,
      paymentWithTaxes:
        tx.paymentWithTaxes !== undefined ? Number(tx.paymentWithTaxes) : undefined,
      idempotent,
    };
  }

  private async appendLedgerCashIn(tx: TransactionDocument) {
    const amount = Number(tx.amount ?? 0);
    if (amount <= 0) return;

    await this.ledgerModel
      .updateOne(
        { transactionId: tx._id, entryType: 'CASH_IN' },
        {
          $setOnInsert: {
            transactionId: tx._id,
            userId: tx.userId,
            raffleId: tx.raffleId,
            entryType: 'CASH_IN',
            amount,
            currency: tx.currency ?? 'XAF',
            provider: tx.provider ?? 'UNKNOWN',
            providerRef: tx.providerRef ?? '',
          },
        },
        { upsert: true },
      )
      .exec();
  }

  private async finalizeSuccessfulTransaction(tx: TransactionDocument) {
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

    await this.usersService.evaluateMilestones(tx.userId.toString());
    await this.appendLedgerCashIn(tx);
  }

  async createIntent(userId: string, dto: CreateIntentDto) {
    const raffle = await this.rafflesService.adminGetById(dto.raffleId);
    this.assertRafflePurchasable(raffle);

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
    const provider = dto.provider ?? (this.mockPaymentsEnabled() ? 'MOCK' : 'DIGIKUNTZ');

    if (provider === 'MOCK' && !this.mockPaymentsEnabled()) {
      throw new BadRequestException('Mock payments are disabled');
    }
    let digikuntzInput:
      | {
          userEmail: string;
          userPhone: string;
          userCountry: string;
          senderName: string;
        }
      | undefined;

    if (provider === 'DIGIKUNTZ') {
      const user = await this.usersService.findById(userId);
      const fallbackSenderName = this.firstNonEmpty(
        `${String((user as any)?.firstName ?? '').trim()} ${String((user as any)?.lastName ?? '').trim()}`.trim(),
        String((user as any)?.username ?? '').trim(),
        'Tingilin User',
      );
      const defaultCountry = this.firstNonEmpty(
        String(this.config.get<string>('DIGIKUNTZ_DEFAULT_COUNTRY', '')).trim(),
        'CM',
      );

      const userEmail = this.firstNonEmpty(
        dto.userEmail,
        String((user as any)?.email ?? '').trim(),
      );
      const userPhone = this.normalizePhone(
        this.firstNonEmpty(dto.userPhone, String((user as any)?.phone ?? '').trim()),
      );
      const userCountry = this.firstNonEmpty(dto.userCountry, defaultCountry);
      const senderName = this.firstNonEmpty(dto.senderName, fallbackSenderName);

      if (!userEmail || !userPhone || !userCountry || !senderName) {
        throw new BadRequestException(
          'DIGIKUNTZ requires userEmail, userPhone, userCountry, senderName',
        );
      }

      digikuntzInput = {
        userEmail,
        userPhone,
        userCountry,
        senderName,
      };
    }

    const idempotencyKey = this.normalizeIdempotencyKey(dto.idempotencyKey);
    if (idempotencyKey) {
      const existing = await this.txModel
        .findOne({
          userId: new Types.ObjectId(userId),
          idempotencyKey,
        })
        .sort({ createdAt: -1 })
        .exec();
      if (existing) {
        return this.buildIntentResponse(existing, unit, true);
      }
    }

    const participation = await this.participationsService.getOrCreate(
      dto.raffleId,
      userId,
    );

    const blockedUntil =
      participation?.blockedUntil instanceof Date
        ? participation.blockedUntil
        : null;
    if (blockedUntil && blockedUntil.getTime() > Date.now()) {
      throw new BadRequestException('Temporarily blocked due to failed payments');
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

    let tx: TransactionDocument;
    try {
      tx = await this.txModel.create({
        userId: new Types.ObjectId(userId),
        raffleId: new Types.ObjectId(dto.raffleId),
        quantity,
        amount,
        currency: raffle.currency ?? 'XAF',
        provider,
        status: 'PENDING',
        idempotencyKey: idempotencyKey ?? undefined,
      });
    } catch (error) {
      if (idempotencyKey && this.isDuplicateKeyError(error, 'idempotencyKey')) {
        const existing = await this.txModel
          .findOne({
            userId: new Types.ObjectId(userId),
            idempotencyKey,
          })
          .sort({ createdAt: -1 })
          .exec();

        if (existing) {
          return this.buildIntentResponse(existing, unit, true);
        }
      }

      this.rethrowPersistenceError(error);
    }

    if (provider === 'DIGIKUNTZ') {
      const payin = await this.digikuntz.createPayin({
        amount,
        reason: `TINGILIN|${tx._id.toString()}|${dto.raffleId}|${userId}|qty:${quantity}`,
        userEmail: digikuntzInput!.userEmail,
        userPhone: digikuntzInput!.userPhone,
        userCountry: digikuntzInput!.userCountry,
        senderName: digikuntzInput!.senderName,
      });

      const providerTransactionId = this.firstNonEmpty(
        payin?.id,
        payin?.transactionId,
        payin?.providerTransactionId,
      );
      const providerRef = this.firstNonEmpty(
        payin?.transactionRef,
        payin?.providerRef,
        payin?.reference,
        payin?.ref,
      );
      const paymentLink = this.firstNonEmpty(
        payin?.paymentLink,
        payin?.payment_url,
        payin?.url,
        payin?.link,
      );
      const providerStatus = this.firstNonEmpty(
        payin?.status,
        payin?.state,
        'PENDING',
      );
      const paymentWithTaxes = Number(
        payin?.paymentWithTaxes ??
          payin?.amountWithTaxes ??
          payin?.amount_with_taxes ??
          0,
      );

      if (!providerTransactionId && !providerRef && !paymentLink) {
        throw new BadGatewayException(
          'Digikuntz createPayin returned an invalid response payload',
        );
      }

      tx.provider = 'DIGIKUNTZ';
      tx.providerTransactionId = providerTransactionId || undefined;
      tx.providerRef = providerRef || undefined;
      tx.paymentLink = paymentLink || undefined;
      tx.paymentWithTaxes = Number.isFinite(paymentWithTaxes)
        ? paymentWithTaxes
        : 0;
      tx.rawProviderStatus = providerStatus;
      try {
        await tx.save();
      } catch (error: any) {
        const duplicateKey = Number(error?.code ?? 0) === 11000;
        if (duplicateKey) {
          const orFilters: any[] = [];
          if (providerTransactionId) {
            orFilters.push({
              provider: 'DIGIKUNTZ',
              providerTransactionId,
            });
          }
          if (providerRef) {
            orFilters.push({
              provider: 'DIGIKUNTZ',
              providerRef,
            });
          }

          if (orFilters.length > 0) {
            const existing = await this.txModel
              .findOne({ $or: orFilters })
              .sort({ createdAt: -1 })
              .exec();

            if (existing && existing.userId.toString() === userId) {
              return this.buildIntentResponse(existing, unit, true);
            }
          }
        }

        this.rethrowPersistenceError(error);
      }
    }

    return this.buildIntentResponse(tx, unit);
  }

  async mockConfirm(userId: string, dto: MockConfirmDto) {
    if (!this.mockPaymentsEnabled()) {
      throw new NotFoundException('Mock payments are disabled');
    }

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
    await this.finalizeSuccessfulTransaction(tx);

    return { ok: true, transactionId: tx._id.toString(), status: tx.status };
  }

  async adminSummary() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [allTx, monthTx, ledgerRows, monthLedgerRows] = await Promise.all([
      this.txModel.find().lean().exec(),
      this.txModel.find({ createdAt: { $gte: monthStart } }).lean().exec(),
      this.ledgerModel
        .find({
          entryType: 'CASH_IN',
          currency: { $in: ['XAF', 'xof', 'XOF', 'xaf'] },
        })
        .lean()
        .exec(),
      this.ledgerModel
        .find({
          entryType: 'CASH_IN',
          currency: { $in: ['XAF', 'xof', 'XOF', 'xaf'] },
          createdAt: { $gte: monthStart },
        })
        .lean()
        .exec(),
    ]);

    const successTx = allTx.filter((tx: any) => tx.status === 'SUCCESS');
    const successTxXaf = successTx.filter(
      (tx: any) => String(tx.currency ?? 'XAF').toUpperCase() === 'XAF',
    );
    const monthlySuccessXaf = monthTx.filter(
      (tx: any) =>
        tx.status === 'SUCCESS' &&
        String(tx.currency ?? 'XAF').toUpperCase() === 'XAF',
    );

    const byProvider: Record<string, number> = {};
    const providerSource = ledgerRows.length > 0 ? ledgerRows : successTxXaf;
    for (const row of providerSource) {
      const provider = String((row as any).provider ?? 'UNKNOWN').toUpperCase();
      byProvider[provider] = (byProvider[provider] ?? 0) + Number((row as any).amount ?? 0);
    }

    const pendingCount = allTx.filter((tx: any) => tx.status === 'PENDING').length;
    const failedCount = allTx.filter((tx: any) => tx.status === 'FAILED').length;
    const pendingPayoutsXaf = allTx
      .filter(
        (tx: any) =>
          tx.status === 'PENDING' &&
          String(tx.currency ?? 'XAF').toUpperCase() === 'XAF',
      )
      .reduce((sum: number, tx: any) => sum + Number(tx.amount ?? 0), 0);

    const successCount = successTx.length;
    const successRateBase = successCount + pendingCount + failedCount;
    const successRate =
      successRateBase > 0
        ? Number(((successCount / successRateBase) * 100).toFixed(1))
        : 0;

    return {
      currency: 'XAF',
      totalCashInXaf:
        ledgerRows.length > 0
          ? ledgerRows.reduce((sum: number, row: any) => sum + Number(row.amount ?? 0), 0)
          : successTxXaf.reduce((sum: number, tx: any) => sum + Number(tx.amount ?? 0), 0),
      monthCashInXaf:
        monthLedgerRows.length > 0
          ? monthLedgerRows.reduce((sum: number, row: any) => sum + Number(row.amount ?? 0), 0)
          : monthlySuccessXaf.reduce((sum: number, tx: any) => sum + Number(tx.amount ?? 0), 0),
      successCount,
      pendingCount,
      failedCount,
      pendingPayoutsXaf,
      successRate,
      byProvider,
    };
  }

  async adminDashboardAnalytics(params?: {
    granularity?: string;
    dateFrom?: string;
    dateTo?: string;
  }) {
    const granularity = this.parseDashboardGranularity(params?.granularity);
    const range = this.buildDashboardRange(
      granularity,
      params?.dateFrom,
      params?.dateTo,
    );

    const [currentKpis, previousKpis, seriesRows, providerRows, topRafflesRaw, recent] =
      await Promise.all([
        this.aggregateDashboardKpis(range.from, range.to),
        this.aggregateDashboardKpis(range.previousFrom, range.previousTo),
        this.txModel
          .aggregate([
            { $match: { createdAt: { $gte: range.from, $lte: range.to } } },
            {
              $group: {
                _id: {
                  $dateToString: {
                    format: range.bucketFormat,
                    date: '$createdAt',
                    timezone: this.analyticsTimezone,
                  },
                },
                transactions: { $sum: 1 },
                successTransactions: {
                  $sum: { $cond: [{ $eq: ['$status', 'SUCCESS'] }, 1, 0] },
                },
                ticketsSold: {
                  $sum: {
                    $cond: [{ $eq: ['$status', 'SUCCESS'] }, '$quantity', 0],
                  },
                },
                cashIn: {
                  $sum: {
                    $cond: [this.xafCondition('SUCCESS'), '$amount', 0],
                  },
                },
                refunded: {
                  $sum: {
                    $cond: [this.xafCondition('REFUNDED'), '$amount', 0],
                  },
                },
              },
            },
            { $sort: { _id: 1 } },
          ])
          .exec(),
        this.txModel
          .aggregate([
            {
              $match: {
                createdAt: { $gte: range.from, $lte: range.to },
                status: 'SUCCESS',
              },
            },
            {
              $match: {
                $expr: {
                  $in: [
                    { $toUpper: { $ifNull: ['$currency', 'XAF'] } },
                    ['XAF', 'XOF'],
                  ],
                },
              },
            },
            {
              $group: {
                _id: { $toUpper: { $ifNull: ['$provider', 'UNKNOWN'] } },
                cashIn: { $sum: '$amount' },
                ticketsSold: { $sum: '$quantity' },
                transactions: { $sum: 1 },
              },
            },
            { $sort: { cashIn: -1 } },
          ])
          .exec(),
        this.txModel
          .aggregate([
            {
              $match: {
                createdAt: { $gte: range.from, $lte: range.to },
                status: 'SUCCESS',
              },
            },
            {
              $lookup: {
                from: 'raffles',
                localField: 'raffleId',
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
              $group: {
                _id: '$raffleId',
                title: { $first: '$product.title' },
                status: { $first: '$raffle.status' },
                ticketsSold: { $sum: '$quantity' },
                cashIn: {
                  $sum: {
                    $cond: [this.xafCondition('SUCCESS'), '$amount', 0],
                  },
                },
                participantsSet: { $addToSet: '$userId' },
              },
            },
            {
              $project: {
                _id: 0,
                raffleId: { $toString: '$_id' },
                title: { $ifNull: ['$title', 'Raffle'] },
                status: { $ifNull: ['$status', 'UNKNOWN'] },
                ticketsSold: 1,
                cashIn: 1,
                participants: { $size: '$participantsSet' },
              },
            },
            { $sort: { cashIn: -1, ticketsSold: -1 } },
            { $limit: 6 },
          ])
          .exec(),
        this.adminTransactions({
          page: 1,
          limit: 6,
          status: 'ALL',
          dateFrom: range.from.toISOString(),
          dateTo: range.to.toISOString(),
        }),
      ]);

    const seriesMap = new Map<string, any>(
      (seriesRows ?? []).map((row: any) => [String(row?._id ?? ''), row]),
    );
    const keys = this.buildBucketKeys(granularity, range.from, range.to);

    const series = keys.map((key) => {
      const row: any = seriesMap.get(key) ?? {};
      const transactions = Number(row?.transactions ?? 0);
      const successTransactions = Number(row?.successTransactions ?? 0);
      const cashIn = Number(row?.cashIn ?? 0);
      const refunded = Number(row?.refunded ?? 0);

      return {
        bucket: key,
        label: this.toBucketLabel(key, granularity),
        ticketsSold: Number(row?.ticketsSold ?? 0),
        cashIn,
        netCashIn: cashIn - refunded,
        transactions,
        successRate: this.rate(successTransactions, transactions),
      };
    });

    const byProvider = (providerRows ?? []).map((row: any) => ({
      provider: String(row?._id ?? 'UNKNOWN'),
      cashIn: Number(row?.cashIn ?? 0),
      ticketsSold: Number(row?.ticketsSold ?? 0),
      transactions: Number(row?.transactions ?? 0),
    }));

    const topRaffles = (topRafflesRaw ?? []).map((row: any) => ({
      raffleId: String(row?.raffleId ?? ''),
      title: String(row?.title ?? 'Raffle'),
      status: String(row?.status ?? 'UNKNOWN'),
      ticketsSold: Number(row?.ticketsSold ?? 0),
      cashIn: Number(row?.cashIn ?? 0),
      participants: Number(row?.participants ?? 0),
    }));

    return {
      granularity,
      timezone: this.analyticsTimezone,
      currency: 'XAF',
      range: {
        label: range.label,
        dateFrom: range.from.toISOString(),
        dateTo: range.to.toISOString(),
      },
      kpis: {
        ticketsSold: currentKpis.ticketsSold,
        ticketsSoldDeltaPct: this.deltaPercent(
          currentKpis.ticketsSold,
          previousKpis.ticketsSold,
        ),
        cashIn: currentKpis.cashIn,
        cashInDeltaPct: this.deltaPercent(currentKpis.cashIn, previousKpis.cashIn),
        netCashIn: currentKpis.netCashIn,
        netCashInDeltaPct: this.deltaPercent(
          currentKpis.netCashIn,
          previousKpis.netCashIn,
        ),
        transactions: currentKpis.transactions,
        transactionsDeltaPct: this.deltaPercent(
          currentKpis.transactions,
          previousKpis.transactions,
        ),
        successRate: currentKpis.successRate,
        successRateDeltaPct: this.deltaPercent(
          currentKpis.successRate,
          previousKpis.successRate,
        ),
        averageBasket: currentKpis.averageBasket,
        averageBasketDeltaPct: this.deltaPercent(
          currentKpis.averageBasket,
          previousKpis.averageBasket,
        ),
      },
      series,
      byProvider,
      topRaffles,
      recentTransactions: recent?.data ?? [],
    };
  }

  async adminReconciliation(params?: { dateFrom?: string; dateTo?: string }) {
    const dateFromRaw = String(params?.dateFrom ?? '').trim();
    const dateToRaw = String(params?.dateTo ?? '').trim();

    const txMatch: Record<string, any> = {
      currency: { $in: ['XAF', 'XOF', 'xaf', 'xof'] },
      amount: { $gt: 0 },
    };
    const ledgerMatch: Record<string, any> = {
      currency: { $in: ['XAF', 'XOF', 'xaf', 'xof'] },
      entryType: 'CASH_IN',
    };

    if (dateFromRaw || dateToRaw) {
      const createdAt: Record<string, Date> = {};
      if (dateFromRaw) {
        const dateFrom = new Date(dateFromRaw);
        if (Number.isNaN(dateFrom.getTime())) {
          throw new BadRequestException('Invalid dateFrom');
        }
        createdAt.$gte = dateFrom;
      }
      if (dateToRaw) {
        const dateTo = new Date(dateToRaw);
        if (Number.isNaN(dateTo.getTime())) {
          throw new BadRequestException('Invalid dateTo');
        }
        createdAt.$lte = dateTo;
      }
      txMatch.createdAt = createdAt;
      ledgerMatch.createdAt = createdAt;
    }

    const [txRows, ledgerRows] = await Promise.all([
      this.txModel
        .find(txMatch)
        .select('amount provider status')
        .lean()
        .exec(),
      this.ledgerModel
        .find(ledgerMatch)
        .select('amount provider createdAt')
        .lean()
        .exec(),
    ]);

    const intentsAmountXaf = txRows.reduce(
      (sum: number, row: any) => sum + Number(row.amount ?? 0),
      0,
    );
    const confirmedCashInXaf = ledgerRows.reduce(
      (sum: number, row: any) => sum + Number(row.amount ?? 0),
      0,
    );
    const pendingAmountXaf = txRows
      .filter((row: any) => row.status === 'PENDING')
      .reduce((sum: number, row: any) => sum + Number(row.amount ?? 0), 0);
    const failedAmountXaf = txRows
      .filter((row: any) => row.status === 'FAILED')
      .reduce((sum: number, row: any) => sum + Number(row.amount ?? 0), 0);

    const byProvider: Record<
      string,
      { intentsXaf: number; confirmedXaf: number; pendingXaf: number; failedXaf: number }
    > = {};

    for (const tx of txRows) {
      const provider = String((tx as any).provider ?? 'UNKNOWN').toUpperCase();
      byProvider[provider] = byProvider[provider] ?? {
        intentsXaf: 0,
        confirmedXaf: 0,
        pendingXaf: 0,
        failedXaf: 0,
      };
      byProvider[provider].intentsXaf += Number((tx as any).amount ?? 0);
      if ((tx as any).status === 'PENDING') {
        byProvider[provider].pendingXaf += Number((tx as any).amount ?? 0);
      }
      if ((tx as any).status === 'FAILED') {
        byProvider[provider].failedXaf += Number((tx as any).amount ?? 0);
      }
    }

    for (const entry of ledgerRows) {
      const provider = String((entry as any).provider ?? 'UNKNOWN').toUpperCase();
      byProvider[provider] = byProvider[provider] ?? {
        intentsXaf: 0,
        confirmedXaf: 0,
        pendingXaf: 0,
        failedXaf: 0,
      };
      byProvider[provider].confirmedXaf += Number((entry as any).amount ?? 0);
    }

    return {
      currency: 'XAF',
      range: {
        dateFrom: dateFromRaw || null,
        dateTo: dateToRaw || null,
      },
      intentsAmountXaf,
      confirmedCashInXaf,
      pendingAmountXaf,
      failedAmountXaf,
      reconciliationGapXaf: intentsAmountXaf - confirmedCashInXaf,
      byProvider,
    };
  }

  async adminTransactions(params?: {
    page?: number;
    limit?: number;
    status?: 'ALL' | 'PENDING' | 'SUCCESS' | 'FAILED' | 'REFUNDED';
    provider?: string;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    maxLimit?: number;
  }) {
    const page = Math.max(1, Number(params?.page ?? 1) || 1);
    const maxLimit = Math.max(1, Number(params?.maxLimit ?? 100) || 100);
    const limit = Math.min(maxLimit, Math.max(1, Number(params?.limit ?? 20) || 20));
    const skip = (page - 1) * limit;
    const status = String(params?.status ?? 'ALL').toUpperCase();
    const provider = String(params?.provider ?? '').trim().toUpperCase();
    const search = String(params?.search ?? '').trim();
    const dateFromRaw = String(params?.dateFrom ?? '').trim();
    const dateToRaw = String(params?.dateTo ?? '').trim();

    const match: Record<string, any> = {};
    if (status !== 'ALL') {
      match.status = status;
    }
    if (provider && provider !== 'ALL') {
      match.provider = provider;
    }
    if (dateFromRaw || dateToRaw) {
      const createdAt: Record<string, Date> = {};

      if (dateFromRaw) {
        const dateFrom = new Date(dateFromRaw);
        if (Number.isNaN(dateFrom.getTime())) {
          throw new BadRequestException('Invalid dateFrom');
        }
        createdAt.$gte = dateFrom;
      }

      if (dateToRaw) {
        const dateTo = new Date(dateToRaw);
        if (Number.isNaN(dateTo.getTime())) {
          throw new BadRequestException('Invalid dateTo');
        }
        createdAt.$lte = dateTo;
      }

      match.createdAt = createdAt;
    }

    const pipeline: any[] = [
      { $match: match },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'user',
        },
      },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'raffles',
          localField: 'raffleId',
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
    ];

    if (search) {
      pipeline.push({
        $match: {
          $or: [
            { 'user.email': { $regex: search, $options: 'i' } },
            { 'user.firstName': { $regex: search, $options: 'i' } },
            { 'user.lastName': { $regex: search, $options: 'i' } },
            { 'product.title': { $regex: search, $options: 'i' } },
            { providerRef: { $regex: search, $options: 'i' } },
          ],
        },
      });
    }

    const countPipeline = [...pipeline, { $count: 'total' }];
    const rowsPipeline = [
      ...pipeline,
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $project: {
          id: { $toString: '$_id' },
          amount: '$amount',
          currency: '$currency',
          quantity: '$quantity',
          provider: '$provider',
          status: '$status',
          providerRef: '$providerRef',
          createdAt: '$createdAt',
          confirmedAt: '$confirmedAt',
          user: {
            id: { $toString: '$user._id' },
            email: '$user.email',
            firstName: '$user.firstName',
            lastName: '$user.lastName',
            avatar: '$user.avatar',
          },
          raffle: {
            id: { $toString: '$raffle._id' },
            status: '$raffle.status',
          },
          product: {
            title: '$product.title',
            imageUrl: '$product.imageUrl',
          },
        },
      },
    ];

    const [countResult, rows] = await Promise.all([
      this.txModel.aggregate(countPipeline).exec(),
      this.txModel.aggregate(rowsPipeline).exec(),
    ]);

    const total = Number(countResult?.[0]?.total ?? 0);
    return {
      data: rows,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async adminExportTransactionsCsv(params?: {
    status?: 'ALL' | 'PENDING' | 'SUCCESS' | 'FAILED' | 'REFUNDED';
    provider?: string;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
  }) {
    const batchSize = 1000;
    const first = await this.adminTransactions({
      ...params,
      page: 1,
      limit: batchSize,
      maxLimit: batchSize,
    });

    const rows: any[] = [...first.data];
    for (let page = 2; page <= first.totalPages; page++) {
      const chunk = await this.adminTransactions({
        ...params,
        page,
        limit: batchSize,
        maxLimit: batchSize,
      });
      rows.push(...chunk.data);
    }

    const header = [
      'transaction_id',
      'created_at',
      'confirmed_at',
      'status',
      'provider',
      'provider_ref',
      'amount',
      'currency',
      'quantity',
      'customer_email',
      'customer_name',
      'raffle_id',
      'raffle_status',
      'product_title',
    ];

    const lines = rows.map((row: any) =>
      [
        row?.id,
        row?.createdAt,
        row?.confirmedAt,
        row?.status,
        row?.provider,
        row?.providerRef,
        row?.amount,
        row?.currency,
        row?.quantity,
        row?.user?.email,
        `${String(row?.user?.firstName ?? '').trim()} ${String(row?.user?.lastName ?? '').trim()}`.trim(),
        row?.raffle?.id,
        row?.raffle?.status,
        row?.product?.title,
      ]
        .map((value) => this.escapeCsvValue(value))
        .join(','),
    );

    return [header.join(','), ...lines].join('\n');
  }

  private escapeCsvValue(value: unknown): string {
    const raw = String(value ?? '');
    if (!/[",\n\r]/.test(raw)) {
      return raw;
    }
    return `"${raw.replace(/"/g, '""')}"`;
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

  async useFreeTicket(userId: string, dto: CreateFreeTicketDto) {
    const raffle = await this.rafflesService.adminGetById(dto.raffleId);
    this.assertRafflePurchasable(raffle);

    await this.usersService.consumeFreeTickets(userId, 1);

    const tx = await this.txModel.create({
      userId: new Types.ObjectId(userId),
      raffleId: new Types.ObjectId(dto.raffleId),
      quantity: 1,
      amount: 0,
      currency: raffle.currency ?? 'XAF',
      provider: 'FREE_TICKET',
      status: 'SUCCESS',
      confirmedAt: new Date(),
      providerRef: `FREE-${Date.now()}-${userId.slice(-6)}`,
    });

    await this.ticketsService.createMany({
      raffleId: dto.raffleId,
      userId,
      transactionId: tx._id.toString(),
      quantity: 1,
    });

    const part = await this.participationsService.upsertAfterPurchase({
      raffleId: dto.raffleId,
      userId,
      quantity: 1,
    });

    await this.rafflesService.incrementStats(
      dto.raffleId,
      1,
      part.wasCreated ? 1 : 0,
    );

    await this.usersService.evaluateMilestones(userId);

    await this.notifications.create({
      userId,
      type: 'FREE_TICKET_USED',
      title: 'Ticket gratuit utilisé 🎁',
      body: `Ton ticket gratuit a été utilisé sur ce raffle.`,
      data: {
        raffleId: dto.raffleId,
        transactionId: tx._id.toString(),
      },
    });

    return {
      ok: true,
      usedFreeTicket: true,
      transactionId: tx._id.toString(),
      status: tx.status,
      quantity: 1,
    };
  }

  async mockFail(userId: string, dto: MockFailDto) {
    if (!this.mockPaymentsEnabled()) {
      throw new NotFoundException('Mock payments are disabled');
    }

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
    await this.notifyPaymentFailed(tx, dto.reason);

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
      await this.finalizeSuccessfulTransaction(tx);

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
      await this.notifyPaymentFailed(
        tx,
        remoteStatus ? `provider:${remoteStatus}` : undefined,
      );
      return { ok: false, status: 'FAILED', remoteStatus };
    }

    await tx.save();
    return { ok: true, status: tx.status, remoteStatus };
  }

  async processDigikuntzWebhook(
    payload: {
      transactionId?: string;
      providerTransactionId?: string;
      providerRef?: string;
      status?: string;
      failReason?: string;
    },
    signature?: string,
    rawBody?: string,
    timestamp?: string,
  ) {
    this.assertValidWebhookSignature(rawBody, signature, timestamp);

    const transactionId = String(payload?.transactionId ?? '').trim();
    const providerTransactionId = String(payload?.providerTransactionId ?? '').trim();
    const providerRef = String(payload?.providerRef ?? '').trim();

    let tx: TransactionDocument | null = null;
    if (transactionId && Types.ObjectId.isValid(transactionId)) {
      tx = await this.txModel.findById(transactionId).exec();
    }
    if (!tx && providerTransactionId) {
      tx = await this.txModel
        .findOne({ provider: 'DIGIKUNTZ', providerTransactionId })
        .exec();
    }
    if (!tx && providerRef) {
      tx = await this.txModel.findOne({ provider: 'DIGIKUNTZ', providerRef }).exec();
    }

    if (!tx) {
      return { ok: true, ignored: true, reason: 'UNKNOWN_TRANSACTION' };
    }

    const remoteStatus = String(payload?.status ?? '').trim().toLowerCase();
    if (!remoteStatus) {
      throw new BadRequestException('Missing status');
    }

    tx.rawProviderStatus = remoteStatus;
    if (providerRef && !tx.providerRef) {
      tx.providerRef = providerRef;
    }

    if (tx.status === 'SUCCESS') {
      await tx.save();
      return {
        ok: true,
        idempotent: true,
        transactionId: tx._id.toString(),
        status: tx.status,
      };
    }

    if (remoteStatus === 'pending') {
      await tx.save();
      return { ok: true, transactionId: tx._id.toString(), status: tx.status };
    }

    if (remoteStatus === 'success' || remoteStatus === 'completed') {
      if (tx.status !== 'PENDING') {
        await tx.save();
        return {
          ok: true,
          idempotent: true,
          transactionId: tx._id.toString(),
          status: tx.status,
        };
      }

      const partBefore = await this.participationsService.getOrCreate(
        tx.raffleId.toString(),
        tx.userId.toString(),
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

      tx.status = 'SUCCESS';
      tx.confirmedAt = new Date();
      await tx.save();
      await this.finalizeSuccessfulTransaction(tx);

      return { ok: true, transactionId: tx._id.toString(), status: tx.status };
    }

    if (
      remoteStatus === 'failed' ||
      remoteStatus === 'closed' ||
      remoteStatus === 'error' ||
      remoteStatus.includes('error')
    ) {
      if (tx.status === 'FAILED') {
        await tx.save();
        return {
          ok: true,
          idempotent: true,
          transactionId: tx._id.toString(),
          status: tx.status,
        };
      }
      tx.status = 'FAILED';
      tx.failReason = String(payload?.failReason ?? `provider:${remoteStatus}`).trim();
      tx.failedAt = new Date();
      await tx.save();
      await this.notifyPaymentFailed(tx, tx.failReason);
      return { ok: true, transactionId: tx._id.toString(), status: tx.status };
    }

    await tx.save();
    return { ok: true, transactionId: tx._id.toString(), status: tx.status };
  }

  private assertValidWebhookSignature(
    rawBody: string | undefined,
    signature: string | undefined,
    timestamp: string | undefined,
  ): void {
    const secret = getRequiredSecret(this.config, 'DIGIKUNTZ_WEBHOOK_SECRET', {
      minLength: 24,
    });
    const signatureMode = getWebhookSignatureMode(this.config);

    if (signatureMode === 'legacy-static') {
      if (!this.timingSafeEqual(secret, String(signature ?? '').trim())) {
        throw new BadRequestException('Invalid webhook signature');
      }
      return;
    }

    const normalizedRawBody = String(rawBody ?? '');
    const normalizedSignature = this.normalizeSignatureDigest(signature);
    const normalizedTimestamp = String(timestamp ?? '').trim();

    if (!normalizedRawBody || !normalizedSignature || !normalizedTimestamp) {
      throw new BadRequestException('Missing webhook signature data');
    }

    const timestampMs = Number(normalizedTimestamp) * 1000;
    if (!Number.isFinite(timestampMs)) {
      throw new BadRequestException('Invalid webhook timestamp');
    }

    const toleranceSeconds = Math.max(
      30,
      Number(
        this.config.get<string>('DIGIKUNTZ_WEBHOOK_TOLERANCE_SECONDS', '300'),
      ) || 300,
    );
    const now = Date.now();
    if (Math.abs(now - timestampMs) > toleranceSeconds * 1000) {
      throw new BadRequestException('Webhook timestamp expired');
    }

    const expected = crypto
      .createHmac('sha256', secret)
      .update(`${normalizedTimestamp}.${normalizedRawBody}`)
      .digest('hex');

    if (!this.timingSafeEqual(expected, normalizedSignature)) {
      throw new BadRequestException('Invalid webhook signature');
    }
  }

  private normalizeSignatureDigest(signature?: string): string {
    return String(signature ?? '')
      .trim()
      .replace(/^sha256=/i, '')
      .toLowerCase();
  }

  private timingSafeEqual(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(String(left ?? ''), 'utf8');
    const rightBuffer = Buffer.from(String(right ?? ''), 'utf8');

    if (leftBuffer.length !== rightBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
  }
}
