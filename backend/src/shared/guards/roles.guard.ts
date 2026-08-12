import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../../user/entities/user.entity';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { AppError, ErrorCodes } from '../errors';
import { JwtPayload } from '../../auth/strategies/jwt.strategy';

/**
 * Role-based access control guard (Req 3.1 - 3.7).
 *
 * Enforcement rules:
 * - Gate → ONLY ticket validation endpoints
 * - Client → Cannot access Organizer-only endpoints
 * - Organizer → BLOCKED from Client-specific endpoints (reservations, purchase, sharing)
 * - Ownership validation is done at the service layer (defense in depth)
 *
 * Anti-enumeration (Req 3.6):
 * - Cross-user access → 404 NOT_FOUND
 * - Own-resource ownership violation → 403 FORBIDDEN
 * - Both simultaneously → 403 takes precedence
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No roles specified → allow all authenticated users
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user as JwtPayload;

    if (!user || !user.role) {
      throw new AppError(
        'Access denied',
        ErrorCodes.FORBIDDEN,
        403,
      );
    }

    const userRole = user.role as UserRole;

    if (!requiredRoles.includes(userRole)) {
      throw new AppError(
        'Access denied',
        ErrorCodes.FORBIDDEN,
        403,
      );
    }

    return true;
  }
}
