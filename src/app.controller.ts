import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AppService } from './app.service';
import { Roles } from './common/decorators/roles.decorator';
import { RolesGuard } from './common/guards/roles.guard';
import { PaymentsService } from './modules/payments/payments.service';
import { RafflesService } from './modules/raffles/raffles.service';
import { UsersService } from './modules/users/users.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly usersService: UsersService,
    private readonly paymentsService: PaymentsService,
    private readonly rafflesService: RafflesService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @UseGuards(AuthGuard('jwt'), RolesGuard)
  @Roles('ADMIN')
  @Get('admin/search')
  async adminGlobalSearch(
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    const query = String(q ?? '').trim();
    const size = Math.min(Math.max(Number(limit ?? '5') || 5, 1), 10);
    if (query.length < 2) {
      return {
        query,
        users: [],
        customers: [],
        payments: [],
        raffles: [],
        winners: [],
      };
    }

    const [users, payments, raffles, winners] = await Promise.all([
      this.usersService.adminList({
        search: query,
        role: 'ALL',
        status: 'ALL',
        page: 1,
        limit: size,
      }),
      this.paymentsService.adminTransactions({
        search: query,
        status: 'ALL',
        page: 1,
        limit: size,
        maxLimit: size,
      }),
      this.rafflesService.adminListAll(),
      this.rafflesService.adminListWinners({
        search: query,
        status: 'ALL',
        page: 1,
        limit: size,
      }),
    ]);

    const queryLower = query.toLowerCase();
    const raffleMatches = (Array.isArray(raffles) ? raffles : [])
      .filter((row: any) =>
        String(row?.product?.title ?? '').toLowerCase().includes(queryLower),
      )
      .slice(0, size)
      .map((row: any) => ({
        id: String(row?.id ?? ''),
        title: String(row?.product?.title ?? 'Raffle'),
        status: String(row?.status ?? ''),
        route: '/app/raffles',
      }));

    return {
      query,
      users: users.data.map((row: any) => ({
        id: row.id,
        name: `${String(row.firstName ?? '').trim()} ${String(row.lastName ?? '').trim()}`.trim() || row.email,
        email: row.email,
        role: row.role,
        avatar: row.avatar ?? null,
        route: '/app/users',
      })),
      customers: users.data
        .filter((row: any) => String(row.role ?? '').toUpperCase() === 'USER')
        .map((row: any) => ({
          id: row.id,
          name: `${String(row.firstName ?? '').trim()} ${String(row.lastName ?? '').trim()}`.trim() || row.email,
          email: row.email,
          avatar: row.avatar ?? null,
          status: row.status,
          route: '/app/customers',
        })),
      payments: payments.data.map((tx: any) => ({
        id: tx.id,
        amount: Number(tx.amount ?? 0),
        status: String(tx.status ?? ''),
        customerName:
          `${String(tx?.user?.firstName ?? '').trim()} ${String(tx?.user?.lastName ?? '').trim()}`.trim() ||
          String(tx?.user?.email ?? ''),
        route: '/app/payments',
      })),
      raffles: raffleMatches,
      winners: winners.data.map((row: any) => ({
        raffleId: row.raffleId,
        winnerName: row.winnerName,
        productTitle: row.productTitle,
        route: '/app/winners',
      })),
    };
  }
}
