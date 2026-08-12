import { SetMetadata } from '@nestjs/common';
import { UserRole } from '../../user/entities/user.entity';

export const ROLES_KEY = 'roles';

/**
 * Decorator to specify which roles can access a route.
 * Used with the RolesGuard.
 *
 * @example
 * @Roles(UserRole.ORGANIZER)
 * @Get('my-events')
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
