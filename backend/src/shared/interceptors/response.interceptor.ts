import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

/**
 * Paginated result interface.
 * Controllers returning paginated data should use this structure.
 * The interceptor detects it and wraps in {data, meta} format.
 */
export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Response interceptor that normalizes all successful API responses.
 *
 * Behavior:
 * - PaginatedResult → wraps in {data, meta: {total, page, pageSize, totalPages}}
 * - Single resource / non-paginated → passes through directly (no envelope)
 * - Error responses are NOT processed here (handled by GlobalExceptionFilter)
 *
 * CRITICAL (Req 16.5): Pagination metadata ONLY appears in paginated success responses.
 * Error responses NEVER get pagination metadata — that's the filter's job.
 *
 * CRITICAL (Req 16.3): Never expose password hashes, internal user IDs of other users,
 * stack traces, or secrets. This is enforced at the DTO level (response DTOs exclude
 * sensitive fields), but the interceptor provides an additional safety net.
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(
    _context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    return next.handle().pipe(
      map((data: unknown) => {
        // If the controller returns a PaginatedResult, wrap it
        if (this.isPaginatedResult(data)) {
          return {
            data: data.data,
            meta: {
              total: data.total,
              page: data.page,
              pageSize: data.pageSize,
              totalPages: Math.ceil(data.total / data.pageSize),
            },
          };
        }

        // Everything else passes through directly (no envelope)
        return data;
      }),
    );
  }

  /**
   * Type guard: checks if the response matches the PaginatedResult shape.
   * A paginated result has: data (array), total (number), page (number), pageSize (number).
   */
  private isPaginatedResult(data: unknown): data is PaginatedResult<unknown> {
    if (!data || typeof data !== 'object') return false;

    const obj = data as Record<string, unknown>;
    return (
      Array.isArray(obj.data) &&
      typeof obj.total === 'number' &&
      typeof obj.page === 'number' &&
      typeof obj.pageSize === 'number'
    );
  }
}
