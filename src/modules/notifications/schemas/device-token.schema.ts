import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type DevicePlatform = 'android' | 'ios' | 'web';
export const DEVICE_PLATFORMS: DevicePlatform[] = ['android', 'ios', 'web'];

/**
 * Jeton push (FCM) d'un telephone. Un jeton appartient a UN appareil: s'il se
 * reconnecte avec un autre compte, le jeton est reattribue (upsert par token).
 */
@Schema({ timestamps: true, collection: 'device_tokens' })
export class DeviceToken {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, required: true, unique: true })
  token!: string;

  @Prop({ type: String, enum: DEVICE_PLATFORMS, required: true })
  platform!: DevicePlatform;

  @Prop({ type: Date, default: () => new Date() })
  lastSeenAt!: Date;
}

export type DeviceTokenDocument = HydratedDocument<DeviceToken>;
export const DeviceTokenSchema = SchemaFactory.createForClass(DeviceToken);
