import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as crypto from 'crypto';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Raffle, RaffleDocument } from './schemas/raffle.schema';
import { normalizeRegion, REGION_LABELS } from '../../common/regions';
import { RafflesLiveGateway } from './raffles.live.gateway';

export type LiveActivityEvent = {
  id: string;
  displayName: string;
  region: string | null;
  quantity: number;
  raffleId: string;
  prizeTitle: string;
  at: string;
};

/**
 * Fil d'activite "Paul M. · Littoral vient de prendre 3 tickets".
 *
 * Vie privee: on ne diffuse JAMAIS le nom complet, le telephone, l'email ni
 * le montant paye. Seulement prenom + initiale du nom + region, et rien du
 * tout si le joueur a desactive l'option dans son profil.
 *
 * Toujours "fire and forget": une erreur ici ne doit jamais faire echouer
 * un achat deja paye et finalise.
 */
@Injectable()
export class LiveActivityService {
  private readonly logger = new Logger(LiveActivityService.name);
  private readonly titleCache = new Map<string, { title: string; expiresAt: number }>();

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Raffle.name)
    private readonly raffleModel: Model<RaffleDocument>,
    private readonly gateway: RafflesLiveGateway,
  ) {}

  announcePurchase(params: { raffleId: string; userId: string; quantity: number }) {
    void this.buildEvent(params)
      .then((event) => {
        if (event) this.gateway.queueActivity(event);
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `live activity skipped: ${String((error as Error)?.message ?? error).slice(0, 160)}`,
        );
      });
  }

  async buildEvent(params: {
    raffleId: string;
    userId: string;
    quantity: number;
  }): Promise<LiveActivityEvent | null> {
    if (
      !Types.ObjectId.isValid(params.userId) ||
      !Types.ObjectId.isValid(params.raffleId)
    ) {
      return null;
    }

    const user: any = await this.userModel
      .findById(params.userId)
      .select('firstName lastName region showInLiveFeed')
      .lean()
      .exec();
    if (!user || user.showInLiveFeed === false) return null;

    const displayName = formatLiveDisplayName(user.firstName, user.lastName);
    if (!displayName) return null;

    const region = normalizeRegion(user.region);
    return {
      id: crypto.randomUUID(),
      displayName,
      region: region ? REGION_LABELS[region] : null,
      quantity: Math.max(1, Math.floor(Number(params.quantity) || 1)),
      raffleId: params.raffleId,
      prizeTitle: await this.prizeTitle(params.raffleId),
      at: new Date().toISOString(),
    };
  }

  private async prizeTitle(raffleId: string): Promise<string> {
    const cached = this.titleCache.get(raffleId);
    if (cached && cached.expiresAt > Date.now()) return cached.title;

    const raffle: any = await this.raffleModel
      .findById(raffleId)
      .select('productId')
      .populate({ path: 'productId', select: 'title' })
      .lean()
      .exec();
    const title =
      String(raffle?.productId?.title ?? '')
        .trim()
        .slice(0, 80) || 'une tombola';

    if (this.titleCache.size > 500) this.titleCache.clear();
    this.titleCache.set(raffleId, { title, expiresAt: Date.now() + 60_000 });
    return title;
  }
}

/** "Paul Mbappe" -> "Paul M." (prenom borne, initiale seulement). */
export function formatLiveDisplayName(firstName?: unknown, lastName?: unknown): string {
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  const first = text(firstName).split(/\s+/)[0]?.slice(0, 20);
  if (!first) return '';
  const initial = text(lastName).charAt(0).toUpperCase();
  return initial ? `${first} ${initial}.` : first;
}
