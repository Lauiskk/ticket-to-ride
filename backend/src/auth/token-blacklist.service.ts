import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Redis-backed token blacklist with fail-open behavior (Req 2.8, 2.9).
 *
 * When a token is revoked (logout, password change, admin action, security incident),
 * its JTI is stored in Redis with a TTL = remaining token lifetime + 60 seconds.
 *
 * If Redis is unavailable:
 * - FAIL-OPEN: allow the request through
 * - Log ERROR with marker "BLACKLIST_UNAVAILABLE" for alerting
 */

const BLACKLIST_PREFIX = 'token:blacklist:';

@Injectable()
export class TokenBlacklistService {
  private readonly logger = new Logger(TokenBlacklistService.name);
  private redis: Redis | null = null;

  constructor(private readonly configService: ConfigService) {
    try {
      const redisUrl = this.configService.get<string>('redis.url');
      if (redisUrl) {
        this.redis = new Redis(redisUrl, {
          maxRetriesPerRequest: 1,
          retryStrategy: (times) => (times > 3 ? null : Math.min(times * 100, 2000)),
          lazyConnect: true,
        });
        this.redis.connect().catch(() => {
          this.logger.warn('Redis connection failed on startup — blacklist will fail-open');
        });
      }
    } catch {
      this.logger.warn('Redis not configured — blacklist will fail-open');
    }
  }

  /**
   * Add a token JTI to the blacklist.
   * TTL should be: remaining token lifetime + 60 seconds.
   */
  async blacklist(jti: string, ttlSeconds: number): Promise<void> {
    if (!this.redis) return;

    try {
      await this.redis.setex(`${BLACKLIST_PREFIX}${jti}`, ttlSeconds, '1');
    } catch (error) {
      this.logger.error(
        `BLACKLIST_UNAVAILABLE: Failed to blacklist token ${jti}`,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Check if a token JTI is blacklisted.
   * FAIL-OPEN: if Redis is unavailable, returns false (allow the request).
   */
  async isBlacklisted(jti: string): Promise<boolean> {
    if (!this.redis) return false;

    try {
      const result = await this.redis.get(`${BLACKLIST_PREFIX}${jti}`);
      return result !== null;
    } catch (error) {
      // FAIL-OPEN (Req 2.9): allow request, log error
      this.logger.error(
        `BLACKLIST_UNAVAILABLE: Failed to check blacklist for ${jti}`,
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  }
}
