import * as fc from 'fast-check';
import { GlobalExceptionFilter } from './global-exception.filter';
import {
  AppError,
  ErrorCodes,
  type ValidationErrorDetail,
} from '../errors';
import { HttpException } from '@nestjs/common';
import { ArgumentsHost } from '@nestjs/common';

/**
 * Property tests for the GlobalExceptionFilter.
 * These validate correctness properties from the design document.
 *
 * Properties covered:
 * - P1: Error Serialization Structure
 * - P2: Unhandled Exception Normalization
 * - P3: Unique Constraint Mapping (PG 23505)
 * - P4: (tested in response.interceptor.spec.ts)
 */

function createMockHost(): { host: ArgumentsHost; getResponseBody: () => unknown; getStatus: () => number } {
  let responseBody: unknown = null;
  let statusCode = 0;

  const mockResponse = {
    status: (code: number) => {
      statusCode = code;
      return mockResponse;
    },
    json: (body: unknown) => {
      responseBody = body;
      return mockResponse;
    },
  };

  const mockRequest = {
    headers: { 'x-request-id': 'test-request-id' },
  };

  const host = {
    switchToHttp: () => ({
      getResponse: () => mockResponse,
      getRequest: () => mockRequest,
    }),
  } as unknown as ArgumentsHost;

  return {
    host,
    getResponseBody: () => responseBody,
    getStatus: () => statusCode,
  };
}

// Arbitrary for generating valid ErrorCodes values
const errorCodeArb = fc.constantFrom(
  ...Object.values(ErrorCodes),
);

// Arbitrary for HTTP status codes (4xx and 5xx)
const httpStatusArb = fc.integer({ min: 400, max: 599 });

// Arbitrary for ValidationErrorDetail
const validationErrorArb: fc.Arbitrary<ValidationErrorDetail> = fc.record({
  field: fc.string({ minLength: 1, maxLength: 30 }),
  message: fc.string({ minLength: 1, maxLength: 100 }),
  code: fc.string({ minLength: 1, maxLength: 20 }),
  expected: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
  received: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
});

describe('GlobalExceptionFilter', () => {
  const filter = new GlobalExceptionFilter();

  describe('Property 1: Error Serialization Structure', () => {
    it('AppError without validation errors serializes to {message, code, statusCode} — no pagination metadata', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 200 }),
          errorCodeArb,
          httpStatusArb,
          (message, code, statusCode) => {
            const error = new AppError(message, code, statusCode);
            const { host, getResponseBody, getStatus } = createMockHost();

            filter.catch(error, host);

            const body = getResponseBody() as Record<string, unknown>;

            // Must have exactly these fields
            expect(body.message).toBe(message);
            expect(body.code).toBe(code);
            expect(body.statusCode).toBe(statusCode);
            expect(getStatus()).toBe(statusCode);

            // Must NOT have pagination metadata (Req 16.5)
            expect(body).not.toHaveProperty('meta');
            expect(body).not.toHaveProperty('data');
            expect(body).not.toHaveProperty('total');
            expect(body).not.toHaveProperty('page');
            expect(body).not.toHaveProperty('pageSize');
            expect(body).not.toHaveProperty('totalPages');

            // Should not have errors array when none provided
            expect(body).not.toHaveProperty('errors');
          },
        ),
        { numRuns: 100 },
      );
    });

    it('AppError WITH validation errors includes errors array with correct structure', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 200 }),
          fc.array(validationErrorArb, { minLength: 1, maxLength: 5 }),
          (message, errors) => {
            const error = new AppError(
              message,
              ErrorCodes.VALIDATION_ERROR,
              400,
              errors,
            );
            const { host, getResponseBody } = createMockHost();

            filter.catch(error, host);

            const body = getResponseBody() as Record<string, unknown>;

            expect(body.message).toBe(message);
            expect(body.code).toBe(ErrorCodes.VALIDATION_ERROR);
            expect(body.statusCode).toBe(400);
            expect(body.errors).toEqual(errors);

            // Each error has required fields
            const errorsArray = body.errors as ValidationErrorDetail[];
            for (const e of errorsArray) {
              expect(typeof e.field).toBe('string');
              expect(typeof e.message).toBe('string');
              expect(typeof e.code).toBe('string');
            }
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('Property 2: Unhandled Exception Normalization', () => {
    it('unknown exceptions return 500 INTERNAL_ERROR with no stack trace', () => {
      fc.assert(
        fc.property(
          // Use strings that are long enough to not be coincidental substrings
          fc.string({ minLength: 10, maxLength: 200 }),
          (errorMessage) => {
            const error = new Error(errorMessage);
            const { host, getResponseBody, getStatus } = createMockHost();

            filter.catch(error, host);

            const body = getResponseBody() as Record<string, unknown>;

            expect(getStatus()).toBe(500);
            expect(body.code).toBe(ErrorCodes.INTERNAL_ERROR);
            expect(body.statusCode).toBe(500);

            // Generic message — the specific error message is never exposed
            expect(body.message).toBe('An unexpected error occurred');

            // Stack trace markers never in response
            const serialized = JSON.stringify(body);
            expect(serialized).not.toContain('at ');
            expect(serialized).not.toContain('.ts:');
            expect(serialized).not.toContain('.js:');
            expect(serialized).not.toContain('Error:');

            // No pagination metadata
            expect(body).not.toHaveProperty('meta');
          },
        ),
        { numRuns: 100 },
      );
    });

    it('non-Error thrown values also return 500 INTERNAL_ERROR', () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.string(),
            fc.integer(),
            fc.constant(null),
            fc.constant(undefined),
            fc.record({ key: fc.string(), value: fc.string() }),
            fc.array(fc.integer(), { maxLength: 3 }),
          ),
          (thrownValue) => {
            const { host, getResponseBody, getStatus } = createMockHost();

            filter.catch(thrownValue, host);

            const body = getResponseBody() as Record<string, unknown>;

            expect(getStatus()).toBe(500);
            expect(body.code).toBe(ErrorCodes.INTERNAL_ERROR);
            expect(body.message).toBe('An unexpected error occurred');
          },
        ),
        { numRuns: 50 },
      );
    });
  });

  describe('Property 3: Unique Constraint Mapping', () => {
    it('PG code 23505 returns 409 ALREADY_EXISTS with field name from constraint', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 1, maxLength: 30 }).filter((s) => /^[a-z_]+$/.test(s)),
          fc.string({ minLength: 1, maxLength: 30 }).filter((s) => /^[a-z_]+$/.test(s)),
          (tableName, fieldName) => {
            // Simulate a TypeORM QueryFailedError with PG unique violation
            const constraintName = `uni_${tableName}_${fieldName}`;
            const queryError = Object.assign(new Error('duplicate key'), {
              name: 'QueryFailedError',
              driverError: {
                code: '23505',
                constraint: constraintName,
              },
            });

            // Make it look like a QueryFailedError to our filter
            Object.setPrototypeOf(queryError, QueryFailedErrorProto);

            const { host, getResponseBody, getStatus } = createMockHost();
            filter.catch(queryError, host);

            const body = getResponseBody() as Record<string, unknown>;

            expect(getStatus()).toBe(409);
            expect(body.code).toBe(ErrorCodes.ALREADY_EXISTS);
            expect(body.statusCode).toBe(409);
            expect(typeof body.message).toBe('string');
            expect((body.message as string).toLowerCase()).toContain(fieldName);
          },
        ),
        { numRuns: 100 },
      );
    });
  });
});
// We need the filter's instanceof check to pass

import { QueryFailedError } from 'typeorm';

const QueryFailedErrorProto = QueryFailedError.prototype;
