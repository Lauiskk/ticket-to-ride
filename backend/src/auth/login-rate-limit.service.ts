import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Login rate limiting service (Req 2.7).
 *
 * 5 failed login attempts within 15 minutes from the same IP
 * → block further attempts from that IP for 30 minutes.
 *
 * Uses Redis for distributed counting. Falls back gracefully if Redis unavailable.
 */

const RATE_LIMIT_PREFIX = 'login:failures:';
const MAX_FAILURES = 5;
const FAILURE_WINDOW_SECONDS = 15 * 60; // 15 minutes
const BLOCK_DURATION_SECONDS = 30 * 60; // 30 minutes
const BLOCK_PREFIX = 'login:blocked:';

@Injectable()
export class LoginRateLimitService {
  private readonly logger = new Logger(LoginRateLimitService.name);
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
          this.logger.warn('Redis connection failed — login rate limiting disabled');
        });
      }
    } catch {
      this.logger.warn('Redis not configured — login rate limiting disabled');
    }
  }

  /**
   * Check if an IP is currently blocked.
   */
  async isBlocked(ip: string): Promise<boolean> {
    if (!this.redis) return false;

    try {
      const blocked = await this.redis.get(`${BLOCK_PREFIX}${ip}`);
      return blocked !== null;
    } catch {
      return false; // fail-open
    }
  }

  /**
   * Record a failed login attempt for an IP.
   * If failures exceed threshold, block the IP.
   */
  async recordFailure(ip: string): Promise<void> {
    if (!this.redis) return;

    try {
      const key = `${RATE_LIMIT_PREFIX}${ip}`;
      const count = await this.redis.incr(key);

      // Set expiry on first failure
      if (count === 1) {
        await this.redis.expire(key, FAILURE_WINDOW_SECONDS);
      }

      // Block if threshold exceeded
      if (count >= MAX_FAILURES) {
        await this.redis.setex(`${BLOCK_PREFIX}${ip}`, BLOCK_DURATION_SECONDS, '1');
        await this.redis.del(key); // Reset counter
        this.logger.warn(`IP ${ip} blocked for 30 minutes after ${MAX_FAILURES} failed login attempts`);
      }
    } catch (error) {
      this.logger.error(
        'Failed to record login failure in Redis',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  /**
   * Reset failures on successful login.
   */
  async resetFailures(ip: string): Promise<void> {
    if (!this.redis) return;

    try {
      await this.redis.del(`${RATE_LIMIT_PREFIX}${ip}`);
    } catch {
      // Non-critical, ignore
    }
  }
}
