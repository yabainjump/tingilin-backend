import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuditLog, AuditLogDocument, AuditLogStatus } from './schemas/audit-log.schema';

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectModel(AuditLog.name)
    private readonly auditModel: Model<AuditLogDocument>,
  ) {}

  async log(input: {
    action: string;
    actorType?: 'ADMIN' | 'SYSTEM';
    actorUserId?: string;
    actorEmail?: string;
    actorRole?: string;
    targetType?: string;
    targetId?: string;
    status?: AuditLogStatus;
    ip?: string;
    userAgent?: string;
    metadata?: Record<string, any>;
  }) {
    const actorUserId =
      input.actorUserId && Types.ObjectId.isValid(input.actorUserId)
        ? new Types.ObjectId(input.actorUserId)
        : undefined;

    await this.auditModel.create({
      action: input.action,
      actorType: input.actorType ?? 'ADMIN',
      actorUserId,
      actorEmail: String(input.actorEmail ?? '').trim(),
      actorRole: String(input.actorRole ?? '').trim(),
      targetType: String(input.targetType ?? '').trim(),
      targetId: String(input.targetId ?? '').trim(),
      status: input.status ?? 'SUCCESS',
      ip: String(input.ip ?? '').trim(),
      userAgent: String(input.userAgent ?? '').trim(),
      metadata: input.metadata ?? {},
    });
  }

  async safeLog(input: Parameters<AuditService['log']>[0]) {
    try {
      await this.log(input);
    } catch (error: any) {
      this.logger.warn(
        `Audit log write failed for action "${input.action}": ${error?.message ?? error}`,
      );
    }
  }

  async adminList(params?: {
    page?: number;
    limit?: number;
    action?: string;
    status?: AuditLogStatus | 'ALL';
    actorUserId?: string;
    targetType?: string;
    targetId?: string;
  }) {
    const page = Math.max(1, Number(params?.page ?? 1) || 1);
    const limit = Math.min(100, Math.max(1, Number(params?.limit ?? 20) || 20));
    const skip = (page - 1) * limit;

    const query: Record<string, any> = {};
    if (String(params?.status ?? 'ALL').toUpperCase() !== 'ALL') {
      query.status = String(params?.status ?? 'SUCCESS').toUpperCase();
    }
    if (params?.action) {
      query.action = { $regex: String(params.action).trim(), $options: 'i' };
    }
    if (params?.actorUserId && Types.ObjectId.isValid(params.actorUserId)) {
      query.actorUserId = new Types.ObjectId(params.actorUserId);
    }
    if (params?.targetType) {
      query.targetType = String(params.targetType).trim();
    }
    if (params?.targetId) {
      query.targetId = String(params.targetId).trim();
    }

    const [rows, total] = await Promise.all([
      this.auditModel
        .find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.auditModel.countDocuments(query).exec(),
    ]);

    return {
      data: rows.map((row: any) => ({
        id: String(row._id),
        action: row.action,
        actorType: row.actorType,
        actorUserId: row.actorUserId ? String(row.actorUserId) : null,
        actorEmail: row.actorEmail ?? '',
        actorRole: row.actorRole ?? '',
        targetType: row.targetType ?? '',
        targetId: row.targetId ?? '',
        status: row.status ?? 'SUCCESS',
        ip: row.ip ?? '',
        userAgent: row.userAgent ?? '',
        metadata: row.metadata ?? {},
        createdAt: row.createdAt ?? null,
      })),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }
}
