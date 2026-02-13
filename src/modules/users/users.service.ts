import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { User, UserDocument, UserRole } from './schemas/user.schema';
import { Ticket, TicketDocument } from '../tickets/schemas/ticket.schema';
import { Raffle, RaffleDocument } from '../raffles/schemas/raffle.schema';
import { Product, ProductDocument } from '../products/schemas/product.schema';

type HistoryResult = 'WON' | 'LOST';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Ticket.name)
    private readonly ticketModel: Model<TicketDocument>,
    @InjectModel(Raffle.name)
    private readonly raffleModel: Model<RaffleDocument>,
    @InjectModel(Product.name)
    private readonly productModel: Model<ProductDocument>,
  ) {}

  async findByEmail(email: string) {
    return this.userModel.findOne({ email: email.toLowerCase() }).exec();
  }

  async findById(id: string) {
    return this.userModel.findById(id).exec();
  }

  async createUser(params: {
    email: string;
    passwordHash: string;
    firstName: string;
    lastName: string;
    phone: string;
    role?: UserRole;
    avatar?: string; // optionnel si tu veux une valeur par défaut
  }) {
    const email = params.email.trim().toLowerCase();

    const firstName = params.firstName.trim();
    const lastName = params.lastName.trim();

    // Normalisation simple (enlève espaces/tirets) — adapte selon ton format
    const phone = params.phone.replace(/\s|-/g, '').trim();

    return this.userModel.create({
      email,
      passwordHash: params.passwordHash,
      firstName,
      lastName,
      phone,
      avatar: params.avatar ?? 'defpic.jpg',
      role: params.role ?? 'USER',
    });
  }

  async updateRole(userId: string, role: 'USER' | 'ADMIN' | 'MODERATOR') {
    return this.userModel
      .findByIdAndUpdate(userId, { role }, { new: true })
      .exec();
  }

  async getMe(userId: string) {
    const u = await this.userModel.findById(userId).lean().exec();
    if (!u) throw new NotFoundException('User not found');

    return {
      id: String(u._id),
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      phone: u.phone,
      role: u.role,
      avatar: u.avatar, // ex: defpic.jpg ou url
      profile: u.profile ?? {},
    };
  }

  async getMyStats(userId: string) {
    const uid = new Types.ObjectId(userId);

    const u = await this.userModel.findById(uid).lean().exec();
    if (!u) throw new NotFoundException('User not found');

    const balance = Number((u.profile as any)?.balance ?? 0);
    const currency = String((u.profile as any)?.currency ?? 'XAF');

    const [ticketsBought, productsWon] = await Promise.all([
      this.ticketModel.countDocuments({ userId: uid }),
      this.raffleModel.countDocuments({ winnerUserId: uid }),
    ]);

    return { balance, currency, ticketsBought, productsWon };
  }

  async getMyHistory(userId: string, limit = 5) {
    const uid = new Types.ObjectId(userId);

    // IMPORTANT:
    // - Ticket doit avoir createdAt (timestamps). Si ton ticket.schema n’a pas timestamps,
    //   ajoute @Schema({ timestamps: true }) sinon lastAt sera vide.
    const rows = await this.ticketModel
      .aggregate([
        { $match: { userId: uid } },
        {
          $group: {
            _id: '$raffleId',
            ticketsCount: { $sum: 1 },
            lastAt: { $max: '$createdAt' },
          },
        },
        { $sort: { lastAt: -1 } },
        { $limit: limit },

        {
          $lookup: {
            from: 'raffles',
            localField: '_id',
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
          $project: {
            ticketsCount: 1,
            lastAt: 1,
            title: '$product.title',
            imageUrl: '$product.imageUrl',
            winnerUserId: '$raffle.winnerUserId',
          },
        },
      ])
      .exec();

    return rows
      .filter((x) => x?.title)
      .map((x) => {
        const ticketsCount = Number(x.ticketsCount ?? 0);

        const isWon =
          x.winnerUserId && String(x.winnerUserId) === String(userId);

        const result: HistoryResult = isWon ? 'WON' : 'LOST';

        return {
          title: String(x.title),
          imageUrl: String(x.imageUrl ?? ''),
          dateLabel: this.formatDateLabel(
            x.lastAt ? new Date(x.lastAt) : new Date(),
          ),
          ticketsLabel: `${ticketsCount} Ticket${ticketsCount > 1 ? 's' : ''}`,
          result,
        };
      });
  }

  private formatDateLabel(d: Date): string {
    const s = new Intl.DateTimeFormat('fr-FR', {
      day: '2-digit',
      month: 'short',
    }).format(d);

    return s.replace('.', ''); // ex "24 oct" -> "24 oct"
  }
}
