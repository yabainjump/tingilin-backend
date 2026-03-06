import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

export type NotificationType =
  | 'PAYMENT_SUCCESS'
  | 'RAFFLE_CREATED'
  | 'ENDING_SOON'
  | 'WINNER_ANNOUNCED'
  | 'FREE_TICKET_USED';

@Schema({ timestamps: true })
export class Notification {
  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  type: NotificationType;

  @Prop({ required: true })
  title: string;

  @Prop({ required: true })
  body: string;

  @Prop({ type: Object, default: {} })
  data: Record<string, any>;

  @Prop({ type: Date, default: null })
  readAt: Date | null;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

NotificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });
