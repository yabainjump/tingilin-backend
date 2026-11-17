import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuditService } from '../audit/audit.service';
import { PollsService } from './polls.service';
import { CreatePollDto } from './dto/poll.dto';

@ApiTags('Polls Admin')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
@Controller('admin/polls')
export class PollsAdminController {
  constructor(
    private readonly pollsService: PollsService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  list() {
    return this.pollsService.adminList();
  }

  @Post()
  async create(@Body() dto: CreatePollDto, @Req() req: any) {
    const poll = await this.pollsService.adminCreate(dto, req.user?.sub);
    await this.audit(req, 'ADMIN_POLL_CREATED', poll.id);
    return poll;
  }

  @Put(':id')
  async update(@Param('id') id: string, @Body() dto: CreatePollDto, @Req() req: any) {
    const poll = await this.pollsService.adminUpdate(id, dto);
    await this.audit(req, 'ADMIN_POLL_UPDATED', id);
    return poll;
  }

  @Patch(':id/open')
  async open(@Param('id') id: string, @Req() req: any) {
    const poll = await this.pollsService.adminOpen(id);
    await this.audit(req, 'ADMIN_POLL_OPENED', id);
    return poll;
  }

  @Patch(':id/close')
  async close(@Param('id') id: string, @Req() req: any) {
    const poll = await this.pollsService.adminClose(id);
    await this.audit(req, 'ADMIN_POLL_CLOSED', id);
    return poll;
  }

  @Delete(':id')
  async remove(@Param('id') id: string, @Req() req: any) {
    const result = await this.pollsService.adminDelete(id);
    await this.audit(req, 'ADMIN_POLL_DELETED', id);
    return result;
  }

  private audit(req: any, action: string, targetId: string) {
    return this.auditService.safeLog({
      action,
      actorUserId: req.user?.sub,
      actorEmail: req.user?.email,
      actorRole: req.user?.role,
      targetType: 'POLL',
      targetId,
      ip: req.ip,
      userAgent: req.headers?.['user-agent'],
    });
  }
}
