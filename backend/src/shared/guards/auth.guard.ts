import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { TokenBlacklistService } from '../../auth/token-blacklist.service';
import { JwtPayload } from '../../auth/strategies/jwt.strategy';

/**
 * Global authentication guard.
 *
 * Behavior:
 * 1. Skip validation for @Public() routes
 * 2. Extract JWT from cookie (access_token) → fallback to Authorization header
 * 3. Verify JWT signature and expiry
 * 4. Check token blacklist (fail-open if Redis unavailable) (Req 2.9)
 * 5. Set request.user with decoded claims
 */
@Injectable()
export class AppAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly blacklistService: TokenBlacklistService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if route is public
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('Authentication required');
    }

    // Verify JWT
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(token, {
        secret: this.configService.get<string>('jwt.secret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Check blacklist (fail-open) (Req 2.8, 2.9)
    if (payload.jti) {
      const isBlacklisted = await this.blacklistService.isBlacklisted(payload.jti);
      if (isBlacklisted) {
        throw new UnauthorizedException('Token has been revoked');
      }
    }

    // Set user on request
    (request as any).user = payload;
    return true;
  }

  /**
   * Dual-source token extraction (Req 2.2, 2.3):
   * 1. HttpOnly cookie "access_token" (preferred)
   * 2. Authorization: Bearer <token> header (fallback)
   */
  private extractToken(request: Request): string | null {
    // 1. Try cookie
    const cookieToken = request.cookies?.['access_token'];
    if (cookieToken) return cookieToken;

    // 2. Try Authorization header
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.slice(7);
    }

    return null;
  }
}
