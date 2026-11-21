import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { cert, initializeApp, type App } from 'firebase-admin/app';
import {
  getMessaging,
  type Messaging,
  type MulticastMessage,
} from 'firebase-admin/messaging';
import {
  DeviceToken,
  DeviceTokenDocument,
  type DevicePlatform,
} from './schemas/device-token.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { loadFirebaseServiceAccount } from './firebase-credentials';

/**
 * TRANSACTIONAL : gain, paiement, ticket offert -> toujours envoye.
 * REMINDER      : "le tirage se termine dans 10 min", resultat -> desactivable.
 * NEW_RAFFLE    : "nouvelle tombola" (diffusion a tous) -> desactivable.
 */
export type PushCategory = 'TRANSACTIONAL' | 'REMINDER' | 'NEW_RAFFLE';

export type PushPayload = {
  title: string;
  body: string;
  /** Route interne de l'app ouverte au toucher (ex: /tabs/raffle-details/<id>). */
  deepLink?: string;
  type?: string;
  raffleId?: string;
};

const PREF_FIELD: Record<Exclude<PushCategory, 'TRANSACTIONAL'>, string> = {
  REMINDER: 'pushPrefs.reminders',
  NEW_RAFFLE: 'pushPrefs.newRaffles',
};

/** Seules les routes de l'app sont acceptees comme lien de notification. */
export const PUSH_DEEPLINK_PATTERN = /^\/tabs\/[A-Za-z0-9/_-]{0,120}$/;

/** Erreurs FCM qui signifient "ce jeton ne marchera plus jamais". */
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private messaging: Messaging | null = null;
  private active = 0;
  private readonly waiting: Array<() => void> = [];
  static readonly MAX_CONCURRENT_SENDS = 8;
  static readonly MAX_TOKENS_PER_USER = 10;
  static readonly FCM_BATCH = 500;

  constructor(
    @InjectModel(DeviceToken.name)
    private readonly deviceModel: Model<DeviceTokenDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const { account, problem } = loadFirebaseServiceAccount(this.config);
    if (!account) {
      this.logger.warn(
        `Notifications push desactivees (${problem}). Renseigne FIREBASE_SERVICE_ACCOUNT_FILE pour les activer.`,
      );
      return;
    }
    try {
      const app: App = initializeApp(
        {
          credential: cert({
            projectId: account.projectId,
            clientEmail: account.clientEmail,
            privateKey: account.privateKey,
          }),
        },
        'tinguilin-push',
      );
      this.messaging = getMessaging(app);
      this.logger.log(`Notifications push actives (projet ${account.projectId})`);
    } catch (error) {
      this.logger.error(
        `Initialisation Firebase impossible: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }

  isEnabled(): boolean {
    return this.messaging !== null;
  }

  /** Pour les tests: injecte un client FCM factice. */
  useMessagingForTests(messaging: Messaging | null): void {
    this.messaging = messaging;
  }

  async registerDevice(
    userId: string,
    token: string,
    platform: DevicePlatform,
  ): Promise<void> {
    const uid = new Types.ObjectId(userId);
    await this.deviceModel
      .updateOne(
        { token },
        { $set: { userId: uid, platform, lastSeenAt: new Date() } },
        { upsert: true },
      )
      .exec();

    // Au-dela de 10 appareils, on oublie les plus anciens.
    const extra = await this.deviceModel
      .find({ userId: uid })
      .sort({ lastSeenAt: -1 })
      .skip(PushService.MAX_TOKENS_PER_USER)
      .select('_id')
      .lean()
      .exec();
    if (extra.length) {
      await this.deviceModel
        .deleteMany({ _id: { $in: extra.map((d) => d._id) } })
        .exec();
    }
  }

  async unregisterDevice(userId: string, token: string): Promise<void> {
    await this.deviceModel
      .deleteOne({ token, userId: new Types.ObjectId(userId) })
      .exec();
  }

  /**
   * Envoi "fire and forget" a un joueur: ne bloque ni ne fait echouer
   * l'appelant. Les envois sont limites en parallele pour ne pas saturer le
   * serveur pendant un tirage a 2000 participants.
   */
  notifyUser(userId: string, payload: PushPayload, category: PushCategory): void {
    if (!this.messaging || !Types.ObjectId.isValid(userId)) return;
    void this.limit(() => this.sendToUsers([userId], payload, category)).catch(
      (error: unknown) =>
        this.logger.warn(
          `Push failed: ${error instanceof Error ? error.message : 'unknown error'}`,
        ),
    );
  }

  /** "Nouvelle tombola" a tous les joueurs qui l'acceptent. */
  async broadcast(payload: PushPayload, category: PushCategory): Promise<number> {
    if (!this.messaging) return 0;
    const users = await this.userModel
      .find(this.eligibilityFilter(category))
      .select('_id')
      .lean()
      .exec();
    let sent = 0;
    const ids = users.map((u) => String(u._id));
    for (let i = 0; i < ids.length; i += 1000) {
      sent += (await this.sendToUsers(ids.slice(i, i + 1000), payload, category))
        .sent;
    }
    return sent;
  }

  async sendToUsers(
    userIds: string[],
    payload: PushPayload,
    category: PushCategory,
  ): Promise<{ sent: number; failed: number }> {
    if (!this.messaging || !userIds.length) return { sent: 0, failed: 0 };
    const objectIds = userIds
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));

    const eligible =
      category === 'TRANSACTIONAL'
        ? objectIds
        : (
            await this.userModel
              .find({ _id: { $in: objectIds }, ...this.eligibilityFilter(category) })
              .select('_id')
              .lean()
              .exec()
          ).map((u) => u._id);
    if (!eligible.length) return { sent: 0, failed: 0 };

    const tokens = (
      await this.deviceModel
        .find({ userId: { $in: eligible } })
        .select('token')
        .lean()
        .exec()
    ).map((d) => String(d.token));

    let sent = 0;
    let failed = 0;
    const dead: string[] = [];
    for (let i = 0; i < tokens.length; i += PushService.FCM_BATCH) {
      const batch = tokens.slice(i, i + PushService.FCM_BATCH);
      const res = await this.messaging.sendEachForMulticast(
        this.buildMessage(batch, payload),
      );
      sent += res.successCount;
      failed += res.failureCount;
      res.responses.forEach((r, idx) => {
        if (!r.success && DEAD_TOKEN_CODES.has(String(r.error?.code ?? ''))) {
          dead.push(batch[idx]);
        }
      });
    }
    if (dead.length) {
      await this.deviceModel.deleteMany({ token: { $in: dead } }).exec();
    }
    return { sent, failed };
  }

  buildMessage(tokens: string[], payload: PushPayload): MulticastMessage {
    const clean = (value: unknown, max: number) =>
      String(typeof value === 'string' ? value : '')
        .replace(/[\p{Cc}]+/gu, ' ')
        .trim()
        .slice(0, max);
    const data: Record<string, string> = {};
    const deepLink = clean(payload.deepLink, 140);
    if (PUSH_DEEPLINK_PATTERN.test(deepLink)) data.deepLink = deepLink;
    const type = clean(payload.type, 40);
    if (/^[A-Z_]+$/.test(type)) data.type = type;
    const raffleId = clean(payload.raffleId, 24);
    if (/^[a-f0-9]{24}$/i.test(raffleId)) data.raffleId = raffleId;

    return {
      tokens,
      notification: {
        title: clean(payload.title, 80) || 'Tinguilin',
        body: clean(payload.body, 200),
      },
      data,
      android: {
        priority: 'high',
        notification: {
          channelId: 'tinguilin_default',
          icon: 'ic_stat_tinguilin',
          color: '#6d28d9',
          sound: 'default',
        },
      },
      apns: { payload: { aps: { sound: 'default' } } },
    };
  }

  private eligibilityFilter(category: PushCategory): Record<string, unknown> {
    const filter: Record<string, unknown> = { status: { $ne: 'SUSPENDED' } };
    if (category !== 'TRANSACTIONAL') filter[PREF_FIELD[category]] = { $ne: false };
    return filter;
  }

  private async limit<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= PushService.MAX_CONCURRENT_SENDS) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    }
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}
