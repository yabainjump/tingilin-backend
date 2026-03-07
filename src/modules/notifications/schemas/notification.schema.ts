import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

export type NotificationType =
  | 'PAYMENT_SUCCESS'
  | 'PAYMENT_FAILED'
  | 'RAFFLE_CREATED'
  | 'ENDING_SOON'
  | 'DRAW_STARTED'
  | 'DRAW_RESULT'
  | 'WINNER_ANNOUNCED'
  | 'FREE_TICKET_USED'
  | 'FREE_TICKET_AVAILABLE';

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
NotificationSchema.index({ userId: 1, type: 1, 'data.dedupeKey': 1 });
