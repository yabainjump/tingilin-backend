import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AuditService } from '../audit/audit.service';
import { CreateRaffleDto } from './dto/create-raffle.dto';
import { UpdateWinnerStatusDto } from './dto/update-winner-status.dto';
import { UpdateRaffleDto } from './dto/update-raffle.dto';
import { RafflesService } from './raffles.service';

@ApiTags('Raffles Admin')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
@Controller('admin/raffles')
export class RafflesAdminController {
  constructor(
    private readonly rafflesService: RafflesService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  adminList() {
    return this.rafflesService.adminListAll();
  }

  @Get('winners')
  listWinners(
    @Query('search') search?: string,
    @Query('status')
    status?:
      | 'ALL'
      | 'PENDING_VERIFICATION'
      | 'VERIFIED'
      | 'IN_SHIPPING'
      | 'DELIVERED',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.rafflesService.adminListWinners({
      search,
      status,
      page: Number(page ?? '1'),
      limit: Number(limit ?? '20'),
    });
  }

  @Patch('winners/:id/status')
  async updateWinnerStatus(
    @Param('id') id: string,
    @Body() dto: UpdateWinnerStatusDto,
    @Req() req: any,
  ) {
    try {
      const result = await this.rafflesService.adminUpdateWinnerStatus(
        id,
        dto.status,
      );
      await this.auditService.safeLog({
        action: 'ADMIN_WINNER_STATUS_UPDATED',
        actorUserId: req.user?.sub,
        actorEmail: req.user?.email,
        actorRole: req.user?.role,
        targetType: 'RAFFLE',
        targetId: id,
        metadata: { nextStatus: dto.status },
        ip: req.ip,
        userAgent: req.headers?.['user-agent'],
      });
      return result;
    } catch (error: any) {
      await this.auditService.safeLog({
        action: 'ADMIN_WINNER_STATUS_UPDATED',
        actorUserId: req.user?.sub,
        actorEmail: req.user?.email,
        actorRole: req.user?.role,
        targetType: 'RAFFLE',
        targetId: id,
        status: 'FAILED',
        metadata: { nextStatus: dto.status, error: error?.message ?? 'UNKNOWN' },
        ip: req.ip,
        userAgent: req.headers?.['user-agent'],
      });
      throw error;
    }
  }

  @Get('winners/export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename=\"winners.csv\"')
  async exportWinnersCsv(
    @Query('search') search?: string,
    @Query('status')
    status?:
      | 'ALL'
      | 'PENDING_VERIFICATION'
      | 'VERIFIED'
      | 'IN_SHIPPING'
      | 'DELIVERED',
  ) {
    return this.rafflesService.adminExportWinnersCsv({ search, status });
  }

  @Patch(':id/draw')
  async draw(@Param('id') id: string, @Req() req: any) {
    try {
      const result = await this.rafflesService.adminDrawWinner(id);
      await this.auditService.safeLog({
        action: 'ADMIN_RAFFLE_DRAW_TRIGGERED',
        actorUserId: req.user?.sub,
        actorEmail: req.user?.email,
        actorRole: req.user?.role,
        targetType: 'RAFFLE',
        targetId: id,
        metadata: {
          winnerUserId: result?.winnerUserId ?? null,
          winnerTicketId: result?.winnerTicketId ?? null,
        },
        ip: req.ip,
        userAgent: req.headers?.['user-agent'],
      });
      return result;
    } catch (error: any) {
      await this.auditService.safeLog({
        action: 'ADMIN_RAFFLE_DRAW_TRIGGERED',
        actorUserId: req.user?.sub,
        actorEmail: req.user?.email,
        actorRole: req.user?.role,
        targetType: 'RAFFLE',
        targetId: id,
        status: 'FAILED',
        metadata: { error: error?.message ?? 'UNKNOWN' },
        ip: req.ip,
        userAgent: req.headers?.['user-agent'],
      });
      throw error;
    }
  }

  @Get(':id/winner')
  async winner(@Param('id') id: string) {
    const r = await this.rafflesService.adminGetById(id);
    return {
      raffleId: r._id.toString(),
      status: r.status,
      winnerUserId: r.winnerUserId?.toString() ?? null,
      winnerTicketId: r.winnerTicketId?.toString() ?? null,
      drawnAt: r.drawnAt ?? null,
    };
  }

  @Get(':id')
  adminGet(@Param('id') id: string) {
    return this.rafflesService.adminGetById(id);
  }

  @Post()
  async create(@Body() dto: CreateRaffleDto, @Req() req: any) {
    try {
      const raffle = await this.rafflesService.adminCreate(dto, req.user.sub);
      await this.auditService.safeLog({
        action: 'ADMIN_RAFFLE_CREATED',
        actorUserId: req.user?.sub,
        actorEmail: req.user?.email,
        actorRole: req.user?.role,
        targetType: 'RAFFLE',
        targetId: String(raffle?._id ?? ''),
        metadata: {
          productId: dto.productId,
          ticketPrice: dto.ticketPrice,
          currency: dto.currency ?? 'XAF',
        },
        ip: req.ip,
        userAgent: req.headers?.['user-agent'],
      });
      return raffle;
    } catch (error: any) {
      await this.auditService.safeLog({
        action: 'ADMIN_RAFFLE_CREATED',
        actorUserId: req.user?.sub,
        actorEmail: req.user?.email,
        actorRole: req.user?.role,
        targetType: 'RAFFLE',
        targetId: String(dto.productId ?? ''),
        status: 'FAILED',
        metadata: { error: error?.message ?? 'UNKNOWN' },
        ip: req.ip,
        userAgent: req.headers?.['user-agent'],
      });
      throw error;
    }
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateRaffleDto,
    @Req() req: any,
  ) {
    try {
      const raffle = await this.rafflesService.adminUpdate(id, dto);
      await this.auditService.safeLog({
        action: 'ADMIN_RAFFLE_UPDATED',
        actorUserId: req.user?.sub,
        actorEmail: req.user?.email,
        actorRole: req.user?.role,
        targetType: 'RAFFLE',
        targetId: id,
        metadata: { fields: Object.keys(dto ?? {}) },
        ip: req.ip,
        userAgent: req.headers?.['user-agent'],
      });
      return raffle;
    } catch (error: any) {
      await this.auditService.safeLog({
        action: 'ADMIN_RAFFLE_UPDATED',
        actorUserId: req.user?.sub,
        actorEmail: req.user?.email,
        actorRole: req.user?.role,
        targetType: 'RAFFLE',
        targetId: id,
        status: 'FAILED',
        metadata: {
          fields: Object.keys(dto ?? {}),
          error: error?.message ?? 'UNKNOWN',
        },
        ip: req.ip,
        userAgent: req.headers?.['user-agent'],
      });
      throw error;
    }
  }

  @Patch(':id/start')
  async start(@Param('id') id: string, @Req() req: any) {
    try {
      const raffle = await this.rafflesService.adminStart(id);
      await this.auditService.safeLog({
        action: 'ADMIN_RAFFLE_STARTED',
        actorUserId: req.user?.sub,
        actorEmail: req.user?.email,
        actorRole: req.user?.role,
        targetType: 'RAFFLE',
        targetId: id,
        metadata: { status: raffle?.status },
        ip: req.ip,
        userAgent: req.headers?.['user-agent'],
      });
      return raffle;
    } catch (error: any) {
      await this.auditService.safeLog({
        action: 'ADMIN_RAFFLE_STARTED',
        actorUserId: req.user?.sub,
        actorEmail: req.user?.email,
        actorRole: req.user?.role,
        targetType: 'RAFFLE',
        targetId: id,
        status: 'FAILED',
        metadata: { error: error?.message ?? 'UNKNOWN' },
        ip: req.ip,
        userAgent: req.headers?.['user-agent'],
      });
      throw error;
    }
  }

  @Patch(':id/close')
  async close(@Param('id') id: string, @Req() req: any) {
    try {
      const raffle = await this.rafflesService.adminClose(id);
      await this.auditService.safeLog({
        action: 'ADMIN_RAFFLE_CLOSED',
        actorUserId: req.user?.sub,
        actorEmail: req.user?.email,
        actorRole: req.user?.role,
        targetType: 'RAFFLE',
        targetId: id,
        metadata: { status: raffle?.status },
        ip: req.ip,
        userAgent: req.headers?.['user-agent'],
      });
      return raffle;
    } catch (error: any) {
      await this.auditService.safeLog({
        action: 'ADMIN_RAFFLE_CLOSED',
        actorUserId: req.user?.sub,
        actorEmail: req.user?.email,
        actorRole: req.user?.role,
        targetType: 'RAFFLE',
        targetId: id,
        status: 'FAILED',
        metadata: { error: error?.message ?? 'UNKNOWN' },
        ip: req.ip,
        userAgent: req.headers?.['user-agent'],
      });
      throw error;
    }
  }

  @Delete(':id')
  async delete(@Param('id') id: string, @Req() req: any) {
    try {
      const result = await this.rafflesService.adminDeleteRaffle(id);
      await this.auditService.safeLog({
        action: 'ADMIN_RAFFLE_DELETED',
        actorUserId: req.user?.sub,
        actorEmail: req.user?.email,
        actorRole: req.user?.role,
        targetType: 'RAFFLE',
        targetId: id,
        ip: req.ip,
        userAgent: req.headers?.['user-agent'],
      });
      return result;
    } catch (error: any) {
      await this.auditService.safeLog({
        action: 'ADMIN_RAFFLE_DELETED',
        actorUserId: req.user?.sub,
        actorEmail: req.user?.email,
        actorRole: req.user?.role,
        targetType: 'RAFFLE',
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
