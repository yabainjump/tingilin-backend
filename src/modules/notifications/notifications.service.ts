import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Notification, NotificationType } from './schemas/notification.schema';
import { PushService, type PushCategory } from './push.service';

/**
 * Quelles notifications de l'app partent AUSSI en push sur le telephone.
 * Volontairement selectif: trop de push = l'app est desinstallee.
 */
export function pushCategoryFor(
  type: NotificationType,
  data?: Record<string, any>,
): PushCategory | null {
  switch (type) {
    case 'WINNER_ANNOUNCED':
    case 'PAYMENT_SUCCESS':
    case 'PAYMENT_FAILED':
    case 'FREE_TICKET_AVAILABLE':
      return 'TRANSACTIONAL';
    case 'DRAW_RESULT':
      return 'REMINDER';
    case 'ENDING_SOON':
      // Un seul rappel par tombola: "plus que 10 minutes".
      return Number(data?.windowMin) === 10 ? 'REMINDER' : null;
    default:
      // DRAW_STARTED (suivi du resultat quelques secondes plus tard),
      // FREE_TICKET_USED (action du joueur lui-meme), RAFFLE_CREATED (diffuse
      // a part, a tous les joueurs).
      return null;
  }
}

@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private readonly notifModel: Model<Notification>,
    private readonly push: PushService,
  ) {}

  private pushIfRelevant(input: {
    userId: string;
    type: NotificationType;
    title: string;
    body: string;
    data?: Record<string, any>;
  }): void {
    const category = pushCategoryFor(input.type, input.data);
    if (!category) return;
    this.push.notifyUser(
      String(input.userId),
      {
        title: input.title,
        body: input.body,
        deepLink:
          typeof input.data?.deepLink === 'string' ? input.data.deepLink : undefined,
        raffleId:
          typeof input.data?.raffleId === 'string' ? input.data.raffleId : undefined,
        type: input.type,
      },
      category,
    );
  }

  async create(input: {
    userId: string;
    type: NotificationType;
    title: string;
    body: string;
    data?: Record<string, any>;
  }) {
    const created = await this.notifModel.create({
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      data: input.data ?? {},
      readAt: null,
    });
    this.pushIfRelevant(input);
    return created;
  }

  async createOnce(input: {
    userId: string;
    type: NotificationType;
    title: string;
    body: string;
    dedupeKey: string;
    data?: Record<string, any>;
  }) {
    const key = String(input.dedupeKey ?? '').trim();
    if (!key) {
      return this.create(input);
    }

    const q = {
      userId: input.userId,
      type: input.type,
      'data.dedupeKey': key,
    };

    // Upsert atomique (au lieu de findOne puis create): elimine la race qui
    // creait des doublons quand cron multi-instance ou webhooks concurrents.
    try {
      const result: any = await this.notifModel
        .findOneAndUpdate(
          q,
          {
            $setOnInsert: {
              userId: input.userId,
              type: input.type,
              title: input.title,
              body: input.body,
              data: { ...(input.data ?? {}), dedupeKey: key },
              readAt: null,
            },
          },
          {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true,
            includeResultMetadata: true,
          },
        )
        .exec();
      // Push uniquement a la 1re creation: les doublons (cron rejoue,
      // webhooks concurrents) ne re-sonnent pas le telephone.
      if (result?.lastErrorObject?.updatedExisting === false) {
        this.pushIfRelevant(input);
      }
      return result?.value ?? result;
    } catch (error: any) {
      if (Number(error?.code ?? 0) === 11000) {
        // Un concurrent a insere la meme notification: idempotent.
        const existing = await this.notifModel.findOne(q).lean().exec();
        if (existing) return existing as any;
      }
      throw error;
    }
  }

  async myNotifications(
    userId: string,
    opts: { unreadOnly?: boolean; page?: number; limit?: number },
  ) {
    const page = Math.max(1, Number(opts.page || 1));
    const limit = Math.min(50, Math.max(1, Number(opts.limit || 20)));

    const q: any = { userId };
    if (opts.unreadOnly) q.readAt = null;

    const countQueries = opts.unreadOnly
      ? [this.notifModel.countDocuments(q)]
      : [
          this.notifModel.countDocuments(q),
          this.notifModel.countDocuments({ userId, readAt: null }),
        ];

    const [items, counts] = await Promise.all([
      this.notifModel
        .find(q)
        .select('_id userId type title body data readAt createdAt')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      Promise.all(countQueries),
    ]);
    const total = counts[0];
    const unreadCount = opts.unreadOnly ? total : counts[1];

    return {
      data: items,
      unreadCount,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        hasNextPage: page * limit < total,
      },
    };
  }

  async unreadCount(userId: string) {
    return this.notifModel.countDocuments({ userId, readAt: null });
  }

  async markRead(userId: string, id: string) {
    // sécurité: ne peut modifier que ses notifications
    return this.notifModel.findOneAndUpdate(
      { _id: id, userId },
      { $set: { readAt: new Date() } },
      { new: true },
    );
  }

  async markAllRead(userId: string) {
    await this.notifModel.updateMany(
      { userId, readAt: null },
      { $set: { readAt: new Date() } },
    );
    return { ok: true };
  }
}
