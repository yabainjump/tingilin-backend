import {
  Body,
  Delete,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuditService } from '../audit/audit.service';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { UsersService } from './users.service';

@ApiTags('Users Admin')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
@Controller('admin/users')
export class UsersAdminController {
  constructor(
    private readonly usersService: UsersService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  list(
    @Query('search') search?: string,
    @Query('role') role?: 'ALL' | 'USER' | 'ADMIN' | 'MODERATOR',
    @Query('status') status?: 'ALL' | 'ACTIVE' | 'SUSPENDED',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.usersService.adminList({
      search,
      role,
      status,
      page: Number(page ?? '1'),
      limit: Number(limit ?? '20'),
    });
  }

  @Patch(':id/role')
  async updateRole(
    @Param('id') id: string,
    @Body() dto: UpdateRoleDto,
    @Req() req: any,
  ) {
    try {
      const user = await this.usersService.updateRole(id, dto.role, req.user?.sub);
      await this.auditService.safeLog({
        action: 'ADMIN_USER_ROLE_UPDATED',
        actorUserId: req.user?.sub,
        actorEmail: req.user?.email,
        actorRole: req.user?.role,
        targetType: 'USER',
        targetId: id,
        metadata: { nextRole: dto.role },
        ip: req.ip,
        userAgent: req.headers?.['user-agent'],
      });
      return { id: user?._id?.toString(), email: user?.email, role: user?.role };
    } catch (error: any) {
      await this.auditService.safeLog({
        action: 'ADMIN_USER_ROLE_UPDATED',
        actorUserId: req.user?.sub,
        actorEmail: req.user?.email,
        actorRole: req.user?.role,
        targetType: 'USER',
        targetId: id,
        status: 'FAILED',
        metadata: { nextRole: dto.role, error: error?.message ?? 'UNKNOWN' },
        ip: req.ip,
        userAgent: req.headers?.['user-agent'],
      });
      throw error;
    }
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
    @Req() req: any,
  ) {
    try {
      const user = await this.usersService.updateStatus(id, dto.status, req.user?.sub);
      await this.auditService.safeLog({
        action: 'ADMIN_USER_STATUS_UPDATED',
        actorUserId: req.user?.sub,
        actorEmail: req.user?.email,
        actorRole: req.user?.role,
        targetType: 'USER',
        targetId: id,
        metadata: { nextStatus: dto.status },
        ip: req.ip,
        userAgent: req.headers?.['user-agent'],
      });
      return { id: user?._id?.toString(), email: user?.email, status: user?.status };
    } catch (error: any) {
      await this.auditService.safeLog({
        action: 'ADMIN_USER_STATUS_UPDATED',
        actorUserId: req.user?.sub,
        actorEmail: req.user?.email,
        actorRole: req.user?.role,
        targetType: 'USER',
        targetId: id,
        status: 'FAILED',
        metadata: { nextStatus: dto.status, error: error?.message ?? 'UNKNOWN' },
        ip: req.ip,
        userAgent: req.headers?.['user-agent'],
      });
      throw error;
    }
  }

  @Delete(':id')
  async deleteUser(@Param('id') id: string, @Req() req: any) {
    try {
      const result = await this.usersService.adminDeleteUser(id, req.user?.sub);
      await this.auditService.safeLog({
        action: 'ADMIN_USER_DELETED',
        actorUserId: req.user?.sub,
        actorEmail: req.user?.email,
        actorRole: req.user?.role,
        targetType: 'USER',
        targetId: id,
        metadata: { deletedEmail: result?.email ?? '' },
        ip: req.ip,
        userAgent: req.headers?.['user-agent'],
      });
      return result;
    } catch (error: any) {
      await this.auditService.safeLog({
        action: 'ADMIN_USER_DELETED',
        actorUserId: req.user?.sub,
        actorEmail: req.user?.email,
        actorRole: req.user?.role,
        targetType: 'USER',
        targetId: id,
        status: 'FAILED',
        metadata: { error: error?.message ?? 'UNKNOWN' },
        ip: req.ip,
        userAgent: req.headers?.['user-agent'],
      });
      throw error;
    }
  }
}
