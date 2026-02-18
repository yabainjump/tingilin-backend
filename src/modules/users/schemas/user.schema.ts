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

  @Prop({ required: true })
  firstName!: string;

  @Prop({ required: true })
  lastName!: string;

  @Prop({ required: true, unique: true, index: true })
  phone!: string;

  // photo par défaut demandée dans le doc
  @Prop({ default: '../profile.svg' })
  avatar!: string;

  @Prop({ type: Object, default: {} })
  profile: Record<string, any>;
}

export const UserSchema = SchemaFactory.createForClass(User);
