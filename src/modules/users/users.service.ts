import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument, UserRole } from './schemas/user.schema';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
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
}
