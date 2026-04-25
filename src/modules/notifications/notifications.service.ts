import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Notification, NotificationType } from './schemas/notification.schema';


@Injectable()
export class NotificationsService {
  constructor(
    @InjectModel(Notification.name)
    private readonly notifModel: Model<Notification>,
  ) {}

  async create(input: {
    userId: string;
    type: NotificationType;
    title: string;
    body: string;
    data?: Record<string, any>;
  }) {
    return this.notifModel.create({
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      data: input.data ?? {},
      readAt: null,
    });
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

    const existing = await this.notifModel.findOne(q).lean().exec();
    if (existing) return existing as any;

    return this.create({
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      data: { ...(input.data ?? {}), dedupeKey: key },
    });
  }

  async myNotifications(
    userId: string,
    opts: { unreadOnly?: boolean; page?: number; limit?: number },
  ) {
    const page = Math.max(1, Number(opts.page || 1));
    const limit = Math.min(50, Math.max(1, Number(opts.limit || 20)));

    const q: any = { userId };
    if (opts.unreadOnly) q.readAt = null;

    const [items, total, unreadCount] = await Promise.all([
      this.notifModel
        .find(q)
        .select('_id userId type title body data readAt createdAt')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec(),
      this.notifModel.countDocuments(q),
      this.notifModel.countDocuments({ userId, readAt: null }),
    ]);

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
}import { from } from 'rxjs';

