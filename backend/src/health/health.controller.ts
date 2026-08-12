import { Controller, Get } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { Public } from '../shared/decorators/public.decorator';

/**
 * Health check endpoint (Req 19.1, 19.2).
 *
 * GET /health — no authentication required.
 * Returns 200 if all dependencies are reachable, 503 if any fails.
 */
@Controller('health')
export class HealthController {
  private redis: Redis | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {
    const redisUrl = this.configService.get<string>('redis.url');
    if (redisUrl) {
      this.redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 1,
        retryStrategy: () => null,
        lazyConnect: true,
      });
      this.redis.connect().catch(() => {});
    }
  }

  @Public()
  @Get()
  async check() {
    const db = await this.checkDatabase();
    const redis = await this.checkRedis();

    const allHealthy = db.status === 'up' && redis.status === 'up';

    return {
      status: allHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      dependencies: { database: db, redis },
    };
  }

  private async checkDatabase(): Promise<{ status: string; message?: string }> {
    try {
      await this.dataSource.query('SELECT 1');
      return { status: 'up' };
    } catch (err) {
      return { status: 'down', message: err instanceof Error ? err.message : 'unknown' };
    }
  }

  private async checkRedis(): Promise<{ status: string; message?: string }> {
    if (!this.redis) return { status: 'down', message: 'not configured' };
    try {
      await this.redis.ping();
      return { status: 'up' };
    } catch (err) {
      return { status: 'down', message: err instanceof Error ? err.message : 'unknown' };
    }
  }
}
