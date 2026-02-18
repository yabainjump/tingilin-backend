import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { User, UserDocument, UserRole } from './schemas/user.schema';
import { Ticket, TicketDocument } from '../tickets/schemas/ticket.schema';
import { Raffle, RaffleDocument } from '../raffles/schemas/raffle.schema';
import { Product, ProductDocument } from '../products/schemas/product.schema';
import { UpdateMeDto } from './dto/update-me.dto';

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
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid user id');
    }
    const user = await this.userModel.findById(id).exec();
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  toPublic(user: UserDocument) {
    return {
      _id: user._id.toString(),
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone,
      role: user.role,
      status: user.status,
      avatar: user.avatar,
    };
  }

  async updateMe(id: string, dto: UpdateMeDto) {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('Invalid user id');
    }

    const $set: any = {};
    if (dto.firstName !== undefined) $set.firstName = dto.firstName.trim();
    if (dto.lastName !== undefined) $set.lastName = dto.lastName.trim();
    if (dto.phone !== undefined)
      $set.phone = dto.phone.replace(/\s|-/g, '').trim();
    if (dto.avatar !== undefined) $set.avatar = dto.avatar;

    const updated = await this.userModel
      .findByIdAndUpdate(id, { $set }, { new: true })
      .exec();

    if (!updated) throw new NotFoundException('User not found');
    return updated;
  }

  async createUser(params: {
    email: string;
    passwordHash: string;
    firstName: string;
    lastName: string;
    phone: string;
    role?: UserRole;
    avatar?: string;
  }) {
    const email = params.email.trim().toLowerCase();
    const firstName = params.firstName.trim();
    const lastName = params.lastName.trim();
    const phone = params.phone.replace(/\s|-/g, '').trim();

    return this.userModel.create({
      email,
      passwordHash: params.passwordHash,
      firstName,
      lastName,
      phone,
      avatar: params.avatar ?? 'profile.svg', // cohérent avec ton schema user
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
      avatar: u.avatar,
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

    return s.replace('.', '');
  }
}
