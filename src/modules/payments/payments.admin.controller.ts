import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PaymentsService } from './payments.service';

@ApiTags('Payments Admin')
@ApiBearerAuth('access-token')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('ADMIN')
@Controller('admin/payments')
export class PaymentsAdminController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get('summary')
  summary() {
    return this.paymentsService.adminSummary();
  }

  @Get('dashboard-analytics')
  dashboardAnalytics(
    @Query('granularity') granularity?: 'DAY' | 'MONTH' | 'YEAR',
  ) {
    return this.paymentsService.adminDashboardAnalytics({ granularity });
  }

  @Get('transactions')
  transactions(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: 'ALL' | 'PENDING' | 'SUCCESS' | 'FAILED' | 'REFUNDED',
    @Query('provider') provider?: string,
    @Query('search') search?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.paymentsService.adminTransactions({
      page: Number(page ?? '1'),
      limit: Number(limit ?? '20'),
      status,
      provider,
      search,
      dateFrom,
      dateTo,
    });
  }

  @Get('reconciliation')
  reconciliation(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.paymentsService.adminReconciliation({ dateFrom, dateTo });
  }

  @Get('transactions/export.csv')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="tinguilin-transactions.csv"')
  exportTransactions(
    @Query('status') status?: 'ALL' | 'PENDING' | 'SUCCESS' | 'FAILED' | 'REFUNDED',
    @Query('provider') provider?: string,
    @Query('search') search?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    return this.paymentsService.adminExportTransactionsCsv({
      status,
      provider,
      search,
      dateFrom,
      dateTo,
    });
  }
}
