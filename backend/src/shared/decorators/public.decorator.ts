import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route as public (no authentication required).
 * The AuthGuard checks for this metadata and skips validation.
 *
 * @example
 * @Public()
 * @Get('events')
 * listEvents() { ... }
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
