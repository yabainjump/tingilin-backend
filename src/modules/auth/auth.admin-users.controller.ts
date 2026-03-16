import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuditService } from '../audit/audit.service';
import { AuthService } from './auth.service';
import { InviteUserDto } from './dto/invite-user.dto';

@ApiTags('Authentication')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
@Controller('admin/users')
export class AuthAdminUsersController {
  constructor(
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
  ) {}

  @Post('invite')
  async invite(@Body() dto: InviteUserDto, @Req() req: any) {
    try {
      const result = await this.authService.adminInviteUser(dto);
      await this.auditService.safeLog({
        action: 'ADMIN_USER_INVITED',
        actorUserId: req.user?.sub,
        actorEmail: req.user?.email,
        actorRole: req.user?.role,
        targetType: 'USER',
        targetId: String(result?.user?.id ?? ''),
        metadata: {
          invitedEmail: result?.user?.email,
          invitedRole: result?.user?.role,
        },
        ip: req.ip,
        userAgent: req.headers?.['user-agent'],
      });
      return result;
    } catch (error: any) {
      await this.auditService.safeLog({
        action: 'ADMIN_USER_INVITED',
        actorUserId: req.user?.sub,
        actorEmail: req.user?.email,
        actorRole: req.user?.role,
        targetType: 'USER',
        targetId: String(dto?.email ?? ''),
        status: 'FAILED',
        metadata: {
          invitedEmail: dto?.email,
          invitedRole: dto?.role,
          error: error?.message ?? 'UNKNOWN',
        },
        ip: req.ip,
        userAgent: req.headers?.['user-agent'],
      });
      throw error;
    }
  }
}
