import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

export type UserRole = 'USER' | 'ADMIN' | 'MODERATOR';
export type UserStatus = 'ACTIVE' | 'SUSPENDED';

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true })
  passwordHash: string;

  @Prop({ type: String, default: 'USER' })
  role: UserRole;

  @Prop({ type: String, default: 'ACTIVE' })
  status: UserStatus;

  @Prop({ type: Object, default: {} })
  profile: Record<string, any>;
}

export const UserSchema = SchemaFactory.createForClass(User);
