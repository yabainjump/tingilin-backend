import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';

type MemoryEntry = {
  expiresAt: number;
  sizeBytes: number;
  value: unknown;
};

@Injectable()
export class QueryCacheService {
  private readonly logger = new Logger(QueryCacheService.name);
  private readonly memory = new Map<string, MemoryEntry>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly defaultTtlMs: number;
  private readonly maxEntries: number;
  private readonly maxEntryBytes: number;
  private readonly maxMemoryBytes: number;
  private memoryBytes = 0;
  private lastRedisWarningAt = 0;
  private cacheEpoch = 0;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
    config: ConfigService,
  ) {
    this.defaultTtlMs = this.positiveInteger(
      config.get<string>('PUBLIC_QUERY_CACHE_TTL_MS'),
      10_000,
    );
    this.maxEntries = this.positiveInteger(
      config.get<string>('PUBLIC_QUERY_CACHE_MAX_ENTRIES'),
      250,
    );
    this.maxEntryBytes = this.positiveInteger(
      config.get<string>('PUBLIC_QUERY_CACHE_MAX_ENTRY_BYTES'),
      2 * 1024 * 1024,
    );
    this.maxMemoryBytes = this.positiveInteger(
      config.get<string>('PUBLIC_QUERY_CACHE_MAX_MEMORY_BYTES'),
      32 * 1024 * 1024,
    );
  }

  async remember<T>(
    key: string,
    load: () => Promise<T>,
    ttlMs = this.defaultTtlMs,
  ): Promise<T> {
    const normalizedTtl = Math.max(250, Math.floor(ttlMs));
    if (!this.redis) {
      const memoryValue = this.readMemory<T>(key);
      if (memoryValue.hit) return memoryValue.value;
    }

    const pending = this.inFlight.get(key) as Promise<T> | undefined;
    if (pending) return pending;

    const operation = this.loadAndCache(
      key,
      normalizedTtl,
      this.cacheEpoch,
      load,
    );
    this.inFlight.set(key, operation);

    try {
      return await operation;
    } finally {
      if (this.inFlight.get(key) === operation) {
        this.inFlight.delete(key);
      }
    }
  }

  async invalidatePrefix(prefix: string): Promise<void> {
    const normalizedPrefix = String(prefix ?? '').trim();
    if (!normalizedPrefix) return;

    this.cacheEpoch += 1;
    for (const key of Array.from(this.memory.keys())) {
      if (key.startsWith(normalizedPrefix)) this.deleteMemory(key);
    }
    for (const key of Array.from(this.inFlight.keys())) {
      if (key.startsWith(normalizedPrefix)) this.inFlight.delete(key);
    }

    if (!this.redis) return;

    try {
      let cursor = '0';
      const match = `${this.redisKey(normalizedPrefix)}*`;
      do {
        const [nextCursor, keys] = await this.redis.scan(
          cursor,
          'MATCH',
          match,
          'COUNT',
          100,
        );
        cursor = nextCursor;
        if (keys.length > 0) await this.redis.del(...keys);
      } while (cursor !== '0');
    } catch (error) {
      this.warnRedis(
        `Redis cache invalidation failed: ${this.errorMessage(error)}`,
      );
    }
  }

  private async loadAndCache<T>(
    key: string,
    ttlMs: number,
    epoch: number,
    load: () => Promise<T>,
  ): Promise<T> {
    const redisValue = await this.readRedis<T>(key);
    if (redisValue.hit) {
      if (!this.redis && epoch === this.cacheEpoch) {
        this.writeMemory(
          key,
          redisValue.value,
          ttlMs,
          Buffer.byteLength(redisValue.serialized, 'utf8'),
        );
      }
      return redisValue.value;
    }

    const value = await load();
    const serialized = JSON.stringify(value);

    const sizeBytes = Buffer.byteLength(serialized, 'utf8');
    if (epoch === this.cacheEpoch && sizeBytes <= this.maxEntryBytes) {
      if (!this.redis) this.writeMemory(key, value, ttlMs, sizeBytes);
      await this.writeRedis(key, serialized, ttlMs);
    }

    return value;
  }

  private readMemory<T>(key: string): { hit: true; value: T } | { hit: false } {
    const entry = this.memory.get(key);
    if (!entry) return { hit: false };

    if (entry.expiresAt <= Date.now()) {
      this.deleteMemory(key);
      return { hit: false };
    }

    // Reinsertion keeps the Map ordered as a small LRU cache.
    this.memory.delete(key);
    this.memory.set(key, entry);

    return { hit: true, value: entry.value as T };
  }

  private writeMemory(
    key: string,
    value: unknown,
    ttlMs: number,
    sizeBytes: number,
  ): void {
    this.deleteMemory(key);
    this.memory.set(key, {
      value,
      sizeBytes,
      expiresAt: Date.now() + ttlMs,
    });
    this.memoryBytes += sizeBytes;

    while (
      this.memory.size > this.maxEntries ||
      this.memoryBytes > this.maxMemoryBytes
    ) {
      const oldestKey = this.memory.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.deleteMemory(oldestKey);
    }
  }

  private deleteMemory(key: string): void {
    const entry = this.memory.get(key);
    if (!entry) return;
    this.memoryBytes = Math.max(0, this.memoryBytes - entry.sizeBytes);
    this.memory.delete(key);
  }

  private async readRedis<T>(
    key: string,
  ): Promise<{ hit: true; value: T; serialized: string } | { hit: false }> {
    if (!this.redis) return { hit: false };

    try {
      const serialized = await this.redis.get(this.redisKey(key));
      if (!serialized) return { hit: false };
      return {
        hit: true,
        value: JSON.parse(serialized) as T,
        serialized,
      };
    } catch (error) {
      this.warnRedis(`Redis cache read failed: ${this.errorMessage(error)}`);
      return { hit: false };
    }
  }

  private async writeRedis(
    key: string,
    serialized: string,
    ttlMs: number,
  ): Promise<void> {
    if (!this.redis) return;

    try {
      await this.redis.set(this.redisKey(key), serialized, 'PX', ttlMs);
    } catch (error) {
      this.warnRedis(`Redis cache write failed: ${this.errorMessage(error)}`);
    }
  }

  private redisKey(key: string): string {
    return `tingilin:query-cache:${key}`;
  }

  private positiveInteger(value: string | undefined, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0
      ? Math.floor(parsed)
      : fallback;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private warnRedis(message: string): void {
    const now = Date.now();
    if (now - this.lastRedisWarningAt < 30_000) return;
    this.lastRedisWarningAt = now;
    this.logger.warn(message);
  }
}
