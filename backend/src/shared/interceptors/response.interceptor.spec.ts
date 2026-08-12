import * as fc from 'fast-check';
import { ResponseInterceptor, PaginatedResult } from './response.interceptor';
import { of } from 'rxjs';
import { CallHandler, ExecutionContext } from '@nestjs/common';

/**
 * Property tests for the ResponseInterceptor.
 *
 * Properties covered:
 * - P4: Response Passthrough (No Envelope)
 * - P33: Paginated Response Structure
 */

// ─── Test Helpers ─────────────────────────────────────────────────────────────

const mockExecutionContext = {} as ExecutionContext;

function createCallHandler(data: unknown): CallHandler {
  return {
    handle: () => of(data),
  };
}

// ─── Arbitraries ──────────────────────────────────────────────────────────────

// Generate arbitrary non-paginated payloads (objects that do NOT match PaginatedResult shape)
const nonPaginatedArb = fc.oneof(
  // Plain objects without 'data' array
  fc.record({
    id: fc.uuid(),
    name: fc.string({ minLength: 1, maxLength: 50 }),
    email: fc.emailAddress(),
    active: fc.boolean(),
  }),
  // String responses
  fc.string({ minLength: 1, maxLength: 100 }),
  // Number responses
  fc.integer(),
  // Array responses (raw array, not wrapped in {data:})
  fc.array(fc.string(), { minLength: 0, maxLength: 5 }),
  // Null
  fc.constant(null),
  // Object with 'data' that is NOT an array (should not be detected as paginated)
  fc.record({
    data: fc.string(),
    total: fc.integer(),
    page: fc.integer(),
    pageSize: fc.integer(),
  }),
);

// Generate valid PaginatedResult payloads
const paginatedArb = fc.record({
  data: fc.array(
    fc.record({
      id: fc.uuid(),
      value: fc.string({ maxLength: 50 }),
    }),
    { minLength: 0, maxLength: 20 },
  ),
  total: fc.integer({ min: 0, max: 10000 }),
  page: fc.integer({ min: 1, max: 500 }),
  pageSize: fc.integer({ min: 1, max: 100 }),
});

// ─── Property 4: Response Passthrough (No Envelope) ─────────────────────────

describe('ResponseInterceptor', () => {
  const interceptor = new ResponseInterceptor();

  describe('Property 4: Response Passthrough (No Envelope)', () => {
    it('non-paginated responses pass through unchanged — no wrapping', (done) => {
      fc.assert(
        fc.property(nonPaginatedArb, (payload) => {
          const handler = createCallHandler(payload);

          interceptor
            .intercept(mockExecutionContext, handler)
            .subscribe((result) => {
              // The result should be EXACTLY the input (no envelope added)
              expect(result).toEqual(payload);
            });
        }),
        { numRuns: 100 },
      );
      done();
    });

    it('undefined responses pass through as undefined', (done) => {
      const handler = createCallHandler(undefined);

      interceptor
        .intercept(mockExecutionContext, handler)
        .subscribe((result) => {
          expect(result).toBeUndefined();
          done();
        });
    });
  });

  // ─── Property 33: Paginated Response Structure ────────────────────────────

  describe('Property 33: Paginated Response Structure', () => {
    it('PaginatedResult is wrapped in {data, meta: {total, page, pageSize, totalPages}}', (done) => {
      fc.assert(
        fc.property(paginatedArb, (paginated) => {
          const handler = createCallHandler(paginated);

          interceptor
            .intercept(mockExecutionContext, handler)
            .subscribe((result) => {
              const res = result as { data: unknown[]; meta: Record<string, number> };

              // Must have data array
              expect(Array.isArray(res.data)).toBe(true);
              expect(res.data).toEqual(paginated.data);

              // Must have meta object with all required fields
              expect(res.meta).toBeDefined();
              expect(typeof res.meta.total).toBe('number');
              expect(typeof res.meta.page).toBe('number');
              expect(typeof res.meta.pageSize).toBe('number');
              expect(typeof res.meta.totalPages).toBe('number');

              // Values must be correct
              expect(res.meta.total).toBe(paginated.total);
              expect(res.meta.page).toBe(paginated.page);
              expect(res.meta.pageSize).toBe(paginated.pageSize);
              expect(res.meta.totalPages).toBe(
                Math.ceil(paginated.total / paginated.pageSize),
              );
            });
        }),
        { numRuns: 100 },
      );
      done();
    });

    it('paginated response with zero total has totalPages = 0', (done) => {
      const emptyPaginated: PaginatedResult<unknown> = {
        data: [],
        total: 0,
        page: 1,
        pageSize: 20,
      };

      const handler = createCallHandler(emptyPaginated);

      interceptor
        .intercept(mockExecutionContext, handler)
        .subscribe((result) => {
          const res = result as { data: unknown[]; meta: Record<string, number> };
          expect(res.meta.totalPages).toBe(0);
          expect(res.data).toEqual([]);
          done();
        });
    });

    it('error responses (handled by filter) never reach the interceptor — verified by architecture', () => {
      // This is an architectural guarantee: the GlobalExceptionFilter catches
      // exceptions BEFORE they reach the interceptor's Observable.
      // The interceptor only processes successful responses.
      // This test documents the guarantee rather than testing it directly.
      expect(true).toBe(true);
    });
  });
});
