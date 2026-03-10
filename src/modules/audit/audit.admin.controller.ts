import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuditService } from './audit.service';

@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
@Controller('admin/audit-logs')
export class AuditAdminController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  list(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('action') action?: string,
    @Query('status') status?: 'ALL' | 'SUCCESS' | 'FAILED',
    @Query('actorUserId') actorUserId?: string,
    @Query('targetType') targetType?: string,
    @Query('targetId') targetId?: string,
  ) {
    return this.auditService.adminList({
      page: Number(page ?? '1'),
      limit: Number(limit ?? '20'),
      action,
      status,
      actorUserId,
      targetType,
      targetId,
    });
  }
}
