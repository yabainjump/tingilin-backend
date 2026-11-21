import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import * as crypto from 'crypto';
import {
  Raffle,
  RaffleDocument,
  RaffleStatus,
  WinnerFulfillmentStatus,
} from './schemas/raffle.schema';
import { Product, ProductDocument } from '../products/schemas/product.schema';
import { Ticket, TicketDocument } from '../tickets/schemas/ticket.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { MailService } from '../../common/mail/mail.service';
import { QueryCacheService } from '../../common/cache/query-cache.service';
import { getRequiredSecret } from '../../common/config/runtime-security';
import { renderWinnerClaimEmail } from './emails/winner-claim.email';

export const CLAIM_CODE_PATTERN = /^\d{6}$/;

export type WinnerClaimMatch = {
  raffleId: string;
  prizeTitle: string;
  prizeImageUrl: string | null;
  ticketCode: string | null;
  drawnAt: Date | null;
  fulfillmentStatus: string;
  winner: {
    firstName: string;
    lastName: string;
    email: string | null;
    phone: string | null;
    avatar: string | null;
    region: string | null;
    memberSince: Date | null;
  };
};

/**
 * Code de retrait du gagnant (6 chiffres).
 *
 * - Genere au tirage, envoye au gagnant par email et affiche dans son app.
 * - Stocke sous 2 formes, jamais en clair: une empreinte HMAC (recherche par
 *   l'admin) et un chiffre AES-256-GCM (reaffichage au SEUL gagnant).
 * - Un admin le saisit a la remise: le lot passe directement en DELIVERED et
 *   le code ne peut plus resservir. L'admin ne recoit jamais le code.
 */
@Injectable()
export class WinnerClaimService {
  private readonly logger = new Logger(WinnerClaimService.name);

  constructor(
    @InjectModel(Raffle.name)
    private readonly raffleModel: Model<RaffleDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
    @InjectModel(Ticket.name)
    private readonly ticketModel: Model<TicketDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    private readonly queryCache: QueryCacheService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Cree (ou remplace) le code du gagnant et le lui envoie. Refuse si le lot
   * est deja remis. `isRenewal` = nouveau code demande par un admin.
   */
  async issue(
    raffleId: string,
    opts: { isRenewal: boolean },
  ): Promise<{ raffleId: string; issuedAt: Date; emailDelivered: boolean }> {
    const id = this.objectId(raffleId);
    const raffle: any = await this.raffleModel
      .findById(id)
      .select('+winnerClaim status winner winnerUserId productId')
      .lean()
      .exec();
    if (!raffle) throw new NotFoundException('Raffle not found');
    if (raffle.status !== RaffleStatus.DRAWN || !raffle.winner?.userId) {
      throw new BadRequestException('Raffle has no published winner');
    }
    if (this.isDelivered(raffle)) {
      throw new BadRequestException('Ce lot a déjà été remis');
    }
    if (!opts.isRenewal && raffle.winnerClaim) {
      // Tirage rejoue: on garde le code deja envoye.
      return {
        raffleId: String(id),
        issuedAt: raffle.winnerClaim.issuedAt,
        emailDelivered: false,
      };
    }

    const code = await this.generateUniqueCode(id);
    const issuedAt = new Date();
    const update = await this.raffleModel
      .updateOne(
        {
          _id: id,
          ...(opts.isRenewal
            ? { 'winnerClaim.claimedAt': null }
            : { winnerClaim: null }),
          'winner.fulfillmentStatus': { $ne: WinnerFulfillmentStatus.DELIVERED },
        },
        {
          $set: {
            winnerClaim: {
              codeHash: this.hashCode(code),
              codeEnc: this.encrypt(code),
              issuedAt,
              claimedAt: null,
              claimedBy: null,
            },
          },
        },
      )
      .exec();
    if (Number(update.modifiedCount ?? 0) === 0) {
      throw new ConflictException(
        'Le code de ce lot vient de changer. Recharge la page.',
      );
    }

    const emailDelivered = await this.sendCode(raffle, code, opts.isRenewal);
    if (opts.isRenewal) {
      await this.notifications
        .create({
          userId: String(raffle.winner.userId),
          type: 'WINNER_ANNOUNCED',
          title: '🔑 Nouveau code de retrait',
          body: 'Ton code de retrait a été renouvelé. L’ancien ne fonctionne plus.',
          data: {
            raffleId: String(id),
            deepLink: `/tabs/ticket-details/${String(id)}`,
          },
        })
        .catch(() => undefined);
    }
    return { raffleId: String(id), issuedAt, emailDelivered };
  }

  /** Code du gagnant, pour SON app uniquement (404 pour tout autre compte). */
  async getForWinner(raffleId: string, userId: string) {
    const id = this.objectId(raffleId);
    const raffle: any = await this.raffleModel
      .findOne({
        _id: id,
        status: RaffleStatus.DRAWN,
        'winner.userId': this.objectId(userId),
      })
      .select('+winnerClaim winner')
      .lean()
      .exec();
    if (!raffle) throw new NotFoundException('Not found');

    const claim = raffle.winnerClaim ?? null;
    const delivered = this.isDelivered(raffle);
    return {
      raffleId: String(id),
      fulfillmentStatus: String(
        raffle.winner?.fulfillmentStatus ??
          WinnerFulfillmentStatus.PENDING_VERIFICATION,
      ),
      claimCode:
        claim && !claim.claimedAt && !delivered
          ? this.decrypt(String(claim.codeEnc ?? ''))
          : null,
      issuedAt: claim?.issuedAt ?? null,
      claimedAt: claim?.claimedAt ?? null,
    };
  }

  /** Admin: qui est le gagnant derriere ce code ? (ne consomme pas le code) */
  async lookup(code: string): Promise<{ matches: WinnerClaimMatch[] }> {
    const hash = this.hashCode(this.normalizeCode(code));
    const raffles: any[] = await this.raffleModel
      .find({
        status: RaffleStatus.DRAWN,
        'winnerClaim.codeHash': hash,
        'winnerClaim.claimedAt': null,
      })
      .select('winner productId drawnAt')
      .limit(5)
      .lean()
      .exec();
    if (!raffles.length) {
      throw new NotFoundException('Code inconnu ou déjà utilisé');
    }
    return { matches: await Promise.all(raffles.map((r) => this.describe(r))) };
  }

  /** Admin: remise en main propre. Le lot passe directement en DELIVERED. */
  async confirmHandover(raffleId: string, code: string, adminUserId: string) {
    const id = this.objectId(raffleId);
    const hash = this.hashCode(this.normalizeCode(code));
    const now = new Date();
    const claimed: any = await this.raffleModel
      .findOneAndUpdate(
        {
          _id: id,
          status: RaffleStatus.DRAWN,
          'winnerClaim.codeHash': hash,
          'winnerClaim.claimedAt': null,
        },
        {
          $set: {
            'winnerClaim.claimedAt': now,
            'winnerClaim.claimedBy': Types.ObjectId.isValid(adminUserId)
              ? new Types.ObjectId(adminUserId)
              : null,
            'winner.fulfillmentStatus': WinnerFulfillmentStatus.DELIVERED,
            'winner.fulfillmentUpdatedAt': now,
          },
        },
        { new: true },
      )
      .select('winner')
      .lean()
      .exec();

    if (!claimed) {
      const current: any = await this.raffleModel
        .findById(id)
        .select('winner')
        .lean()
        .exec();
      if (current && this.isDelivered(current)) {
        throw new ConflictException('Ce lot a déjà été remis');
      }
      throw new NotFoundException('Code inconnu ou déjà utilisé');
    }

    await this.queryCache.invalidatePrefix('raffles:').catch(() => undefined);
    await this.notifications
      .create({
        userId: String(claimed.winner.userId),
        type: 'WINNER_ANNOUNCED',
        title: '✅ Lot remis',
        body: 'Ton lot t’a été remis. Merci et profite bien !',
        data: {
          raffleId: String(id),
          deepLink: `/tabs/ticket-details/${String(id)}`,
        },
      })
      .catch(() => undefined);

    return {
      raffleId: String(id),
      status: WinnerFulfillmentStatus.DELIVERED,
      claimedAt: now,
    };
  }

  // ---------------------------------------------------------------- helpers

  private async describe(raffle: any): Promise<WinnerClaimMatch> {
    const [user, product, ticket]: any[] = await Promise.all([
      this.userModel
        .findById(raffle.winner?.userId)
        .select('firstName lastName email phone avatar region createdAt')
        .lean()
        .exec(),
      this.productModel
        .findById(raffle.productId)
        .select('title imageUrl')
        .lean()
        .exec(),
      raffle.winner?.ticketId
        ? this.ticketModel
            .findById(raffle.winner.ticketId)
            .select('serial')
            .lean()
            .exec()
        : null,
    ]);
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
    return {
      raffleId: String(raffle._id),
      prizeTitle: str(product?.title) ?? 'Lot',
      prizeImageUrl: str(product?.imageUrl),
      ticketCode: str(ticket?.serial),
      drawnAt: raffle.winner?.drawnAt ?? raffle.drawnAt ?? null,
      fulfillmentStatus: String(
        raffle.winner?.fulfillmentStatus ??
          WinnerFulfillmentStatus.PENDING_VERIFICATION,
      ),
      winner: {
        firstName: str(user?.firstName) ?? '',
        lastName: str(user?.lastName) ?? '',
        email: str(user?.email),
        phone: str(user?.phone),
        avatar: str(user?.avatar),
        region: str(user?.region),
        memberSince: user?.createdAt ?? null,
      },
    };
  }

  private async sendCode(
    raffle: any,
    code: string,
    isRenewal: boolean,
  ): Promise<boolean> {
    try {
      const [user, product]: any[] = await Promise.all([
        this.userModel
          .findById(raffle.winner.userId)
          .select('firstName lastName email')
          .lean()
          .exec(),
        this.productModel.findById(raffle.productId).select('title').lean().exec(),
      ]);
      const appUrl = this.mail.publicAppUrl();
      if (!user?.email || !appUrl) {
        this.logger.warn(
          `Winner claim email skipped for raffle ${String(raffle._id)}: ${!appUrl ? 'PUBLIC_APP_URL manquant' : 'gagnant sans email'}`,
        );
        return false;
      }
      const email = renderWinnerClaimEmail({
        appName: this.mail.appName(),
        firstName: String(user.firstName ?? ''),
        lastName: String(user.lastName ?? ''),
        prizeTitle: String(product?.title ?? ''),
        code,
        appUrl,
        raffleId: String(raffle._id),
        isRenewal,
      });
      const res = await this.mail.send(String(user.email), email, 'WINNER_CLAIM');
      return res.delivered;
    } catch (error) {
      this.logger.warn(
        `Winner claim email failed for raffle ${String(raffle._id)}: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      return false;
    }
  }

  /** 6 chiffres uniformes, uniques parmi les codes non encore utilises. */
  private async generateUniqueCode(raffleId: Types.ObjectId): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const code = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
      const taken = await this.raffleModel
        .exists({
          _id: { $ne: raffleId },
          'winnerClaim.codeHash': this.hashCode(code),
          'winnerClaim.claimedAt': null,
        })
        .exec();
      if (!taken) return code;
    }
    throw new ConflictException('Impossible de générer un code, réessaie.');
  }

  private normalizeCode(code: string): string {
    const clean = String(code ?? '').replace(/\s+/g, '');
    if (!CLAIM_CODE_PATTERN.test(clean)) {
      throw new BadRequestException('Le code doit contenir 6 chiffres');
    }
    return clean;
  }

  private isDelivered(raffle: any): boolean {
    return (
      String(raffle?.winner?.fulfillmentStatus ?? '') ===
        String(WinnerFulfillmentStatus.DELIVERED) ||
      Boolean(raffle?.winnerClaim?.claimedAt)
    );
  }

  private objectId(value: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(String(value ?? ''))) {
      throw new BadRequestException('Invalid id');
    }
    return new Types.ObjectId(String(value));
  }

  private secret(): string {
    const dedicated = String(
      this.config.get<string>('WINNER_CLAIM_SECRET') ?? '',
    ).trim();
    if (dedicated) {
      return getRequiredSecret(this.config, 'WINNER_CLAIM_SECRET', {
        minLength: 32,
      });
    }
    return getRequiredSecret(this.config, 'JWT_REFRESH_SECRET', {
      minLength: 32,
    });
  }

  hashCode(code: string): string {
    return crypto
      .createHmac('sha256', this.secret())
      .update(`winner-claim:v1:${code}`)
      .digest('hex');
  }

  private encryptionKey(): Buffer {
    return crypto
      .createHash('sha256')
      .update(`winner-claim-enc:v1:${this.secret()}`)
      .digest();
  }

  private encrypt(code: string): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    const data = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]);
    return ['v1', iv, cipher.getAuthTag(), data]
      .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
      .join('.');
  }

  private decrypt(payload: string): string | null {
    try {
      const [version, iv, tag, data] = payload.split('.');
      if (version !== 'v1' || !iv || !tag || !data) return null;
      const decipher = crypto.createDecipheriv(
        'aes-256-gcm',
        this.encryptionKey(),
        Buffer.from(iv, 'base64url'),
      );
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      const code = Buffer.concat([
        decipher.update(Buffer.from(data, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
      return CLAIM_CODE_PATTERN.test(code) ? code : null;
    } catch {
      // Secret change: l'admin peut regenerer un code.
      return null;
    }
  }
}
