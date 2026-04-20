import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Server, Socket } from 'socket.io';
import { RafflesService } from './raffles.service';
import { Raffle, RaffleDocument, RaffleStatus } from './schemas/raffle.schema';
import { Ticket, TicketDocument } from '../tickets/schemas/ticket.schema';

const SOCKET_CORS_ORIGINS = (
  process.env.CORS_ORIGINS ||
  process.env.CLIENT_ORIGIN ||
  'http://localhost:8100,http://127.0.0.1:8100'
)
  .split(',')
  .map((x) => x.trim())
  .filter(Boolean);

type LiveWinnerDto = {
  raffleId: string;
  drawnAt: string;
  prizeTitle: string;
  prizeImageUrl?: string;
  winnerName: string;
  avatar?: string;
  ticketCode: string;
  badgeTone?: 'pink' | 'gold' | 'violet';
};

type LiveDrawPayload = {
  viewersLive: number;
  trustPercent: number;
  analysisProgress: number;
  analysisLabel: 'SCANNING...' | 'VERIFYING...';
  scan: {
    tickets: string[];
    activeIndex: number;
  };
  recent: LiveWinnerDto[];
};

type CachedValue<T> = {
  expiresAt: number;
  value: T;
};

@Injectable()
@WebSocketGateway({
  namespace: '/live-draws',
  cors: {
    origin: SOCKET_CORS_ORIGINS,
    credentials: true,
  },
})
export class RafflesLiveGateway
  implements
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleInit,
    OnModuleDestroy
{
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(RafflesLiveGateway.name);
  private readonly viewerIds = new Set<string>();

  private tickCursor = 0;
  private analysisProgress = 22;
  private timer?: NodeJS.Timeout;
  private recentWinnersCache?: CachedValue<LiveWinnerDto[]>;
  private liveTicketsCache?: CachedValue<string[]>;

  constructor(
    @InjectModel(Raffle.name)
    private readonly raffleModel: Model<RaffleDocument>,
    @InjectModel(Ticket.name)
    private readonly ticketModel: Model<TicketDocument>,
    private readonly rafflesService: RafflesService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.broadcastUpdate();
    }, 3000);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async handleConnection(client: Socket) {
    this.viewerIds.add(client.id);
    await this.pushUpdateToClient(client);
    await this.broadcastUpdate();
  }

  async handleDisconnect(client: Socket) {
    this.viewerIds.delete(client.id);
    await this.broadcastUpdate();
  }

  private async pushUpdateToClient(client: Socket) {
    try {
      const payload = await this.buildPayload();
      client.emit('live_draw:update', payload);
    } catch (error) {
      this.logger.warn(`pushUpdateToClient failed: ${String(error)}`);
    }
  }

  private async broadcastUpdate() {
    if (this.viewerIds.size === 0) {
      return;
    }

    try {
      const payload = await this.buildPayload();
      this.server.emit('live_draw:update', payload);
    } catch (error) {
      this.logger.warn(`broadcastUpdate failed: ${String(error)}`);
    }
  }

  private async buildPayload(): Promise<LiveDrawPayload> {
    const recent = await this.fetchRecentWinners();
    const liveTickets = await this.fetchLiveTickets();

    const fallbackCodes = recent
      .map((w) => String(w.ticketCode ?? '').trim().toUpperCase())
      .filter(Boolean);

    const merged = [...liveTickets, ...fallbackCodes, 'X922', 'B738', 'A492', 'C102', 'E551'];
    const tickets = Array.from(new Set(merged)).slice(0, 7);

    const activeIndex = tickets.length ? this.tickCursor % tickets.length : 0;
    this.tickCursor += 1;

    const step = Math.floor(Math.random() * 4) + 2;
    this.analysisProgress += step;
    if (this.analysisProgress >= 96) {
      this.analysisProgress = 62;
    }

    const analysisLabel: 'SCANNING...' | 'VERIFYING...' =
      this.analysisProgress >= 82 ? 'VERIFYING...' : 'SCANNING...';

    return {
      viewersLive: this.viewerIds.size,
      trustPercent: 99.9,
      analysisProgress: this.analysisProgress,
      analysisLabel,
      scan: {
        tickets,
        activeIndex,
      },
      recent,
    };
  }

  private async fetchRecentWinners(): Promise<LiveWinnerDto[]> {
    if (
      this.recentWinnersCache &&
      this.recentWinnersCache.expiresAt > Date.now()
    ) {
      return this.recentWinnersCache.value;
    }

    const res: any = await this.rafflesService
      .listWinnersPublic(9)
      .catch(() => ({ data: [] }));
    const list = Array.isArray(res?.data) ? res.data : [];
    this.recentWinnersCache = {
      expiresAt: Date.now() + 15_000,
      value: list,
    };
    return list;
  }

  private async fetchLiveTickets(): Promise<string[]> {
    if (this.liveTicketsCache && this.liveTicketsCache.expiresAt > Date.now()) {
      return this.liveTicketsCache.value;
    }

    const now = new Date();
    const live: any = await this.raffleModel
      .findOne({
        status: RaffleStatus.LIVE,
        $or: [{ endAt: { $exists: false } }, { endAt: { $gt: now } }],
      })
      .sort({ endAt: 1, createdAt: -1 })
      .select('_id')
      .lean()
      .exec();

    if (!live?._id) {
      this.liveTicketsCache = {
        expiresAt: Date.now() + 6_000,
        value: [],
      };
      return [];
    }

    const raffleId = new Types.ObjectId(String(live._id));
    const sample: Array<{ serial?: string; userId?: Types.ObjectId }> =
      await this.ticketModel
        .aggregate([
          { $match: { raffleId, status: 'ACTIVE' } },
          { $sample: { size: 7 } },
          { $project: { serial: 1, userId: 1 } },
        ])
        .exec();

    const tickets = sample
      .map((x) => this.toTicketCode(x?.serial))
      .map((x) => x.trim().toUpperCase())
      .filter(Boolean);

    this.liveTicketsCache = {
      expiresAt: Date.now() + 6_000,
      value: tickets,
    };

    return tickets;
  }

  private toTicketCode(serial?: string | null): string {
    const s = String(serial ?? '').trim();
    if (!s) return '';
    const last = s.split('-').pop() || s;
    return last.slice(-4).toUpperCase();
  }
}
