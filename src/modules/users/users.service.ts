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
    role?: UserRole;
  }) {
    return this.userModel.create({
      email: params.email.toLowerCase(),
      passwordHash: params.passwordHash,
      role: params.role ?? 'USER',
    });
  }

  async updateRole(userId: string, role: 'USER' | 'ADMIN' | 'MODERATOR') {
    return this.userModel
      .findByIdAndUpdate(userId, { role }, { new: true })
      .exec();
  }
}
