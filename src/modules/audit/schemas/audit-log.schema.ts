import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type AuditLogDocument = HydratedDocument<AuditLog>;
export type AuditLogStatus = 'SUCCESS' | 'FAILED';

@Schema({ timestamps: true })
export class AuditLog {
  @Prop({ type: String, required: true, index: true })
  action: string;

  @Prop({ type: String, required: true, index: true })
  actorType: 'ADMIN' | 'SYSTEM';

  @Prop({ type: Types.ObjectId, required: false, index: true })
  actorUserId?: Types.ObjectId;

  @Prop({ type: String, required: false, default: '' })
  actorEmail?: string;

  @Prop({ type: String, required: false, default: '' })
  actorRole?: string;

  @Prop({ type: String, required: false, index: true })
  targetType?: string;

  @Prop({ type: String, required: false, index: true })
  targetId?: string;

  @Prop({ type: String, required: true, default: 'SUCCESS', index: true })
  status: AuditLogStatus;

  @Prop({ type: String, required: false, default: '' })
  ip?: string;

  @Prop({ type: String, required: false, default: '' })
  userAgent?: string;

  @Prop({ type: Object, default: {} })
  metadata?: Record<string, any>;
}

export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);

AuditLogSchema.index({ createdAt: -1 });
