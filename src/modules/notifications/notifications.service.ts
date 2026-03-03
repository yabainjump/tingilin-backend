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

  async myNotifications(
    userId: string,
    opts: { unreadOnly?: boolean; page?: number; limit?: number },
  ) {
    const page = Math.max(1, Number(opts.page || 1));
    const limit = Math.min(50, Math.max(1, Number(opts.limit || 20)));

    const q: any = { userId };
    if (opts.unreadOnly) q.readAt = null;

    const [items, total] = await Promise.all([
      this.notifModel
        .find(q)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      this.notifModel.countDocuments(q),
    ]);

    return {
      data: items,
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

