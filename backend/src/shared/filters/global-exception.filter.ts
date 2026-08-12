import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { QueryFailedError } from 'typeorm';
import { AppError, ErrorCodes, type ValidationErrorDetail } from '../errors';

/**
 * Global exception filter that catches ALL unhandled exceptions
 * and returns a standardized error response.
 *
 * Replicates the Go project's ErrorHandler + ResponseHandler pattern:
 * - AppError → {message, code, statusCode, errors?}
 * - HttpException → mapped to standardized format
 * - QueryFailedError (PG 23505) → 409 ALREADY_EXISTS
 * - Unknown → 500 INTERNAL_ERROR (no stack trace in response)
 *
 * CRITICAL (Req 16.5): Error responses NEVER include pagination metadata.
 */

interface ErrorResponse {
  message: string;
  code: string;
  statusCode: number;
  errors?: ValidationErrorDetail[];
}

// PostgreSQL error code for unique constraint violation
const PG_UNIQUE_VIOLATION = '23505';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const errorResponse = this.buildErrorResponse(exception, request);

    response.status(errorResponse.statusCode).json(errorResponse);
  }

  private buildErrorResponse(
    exception: unknown,
    request: Request,
  ): ErrorResponse {
    // 1. AppError — our custom domain errors
    if (exception instanceof AppError) {
      return this.handleAppError(exception);
    }

    // 2. TypeORM QueryFailedError — database constraint violations
    if (exception instanceof QueryFailedError) {
      return this.handleQueryFailedError(exception);
    }

    // 3. NestJS HttpException — framework-level errors (404, validation, etc.)
    if (exception instanceof HttpException) {
      return this.handleHttpException(exception);
    }

    // 4. Unknown — unexpected errors (NEVER expose stack trace)
    return this.handleUnknownError(exception, request);
  }

  /**
   * Handles our custom AppError instances.
   * These already have the correct structure — just serialize them.
   */
  private handleAppError(error: AppError): ErrorResponse {
    const response: ErrorResponse = {
      message: error.message,
      code: error.code,
      statusCode: error.statusCode,
    };

    if (error.errors && error.errors.length > 0) {
      response.errors = error.errors;
    }

    return response;
  }

  /**
   * Handles TypeORM database errors.
   * Detects unique constraint violations (PG code 23505) and maps them
   * to 409 ALREADY_EXISTS with the conflicting field name.
   */
  private handleQueryFailedError(error: QueryFailedError): ErrorResponse {
    const driverError = error.driverError as unknown as Record<string, unknown>;

    if (driverError?.code === PG_UNIQUE_VIOLATION) {
      const field = this.extractConstraintField(driverError);
      return {
        message: field
          ? `The submitted '${field}' already exists`
          : 'A record with this value already exists',
        code: ErrorCodes.ALREADY_EXISTS,
        statusCode: 409,
      };
    }

    // Other DB errors — log and return generic 500
    this.logger.error(
      `Database error: ${error.message}`,
      error.stack,
    );

    return {
      message: 'An unexpected database error occurred',
      code: ErrorCodes.INTERNAL_ERROR,
      statusCode: 500,
    };
  }

  /**
   * Handles NestJS HttpException instances (from guards, pipes, framework).
   * Maps them to our standardized format.
   */
  private handleHttpException(exception: HttpException): ErrorResponse {
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    // class-validator returns {message: string[], error: string, statusCode: number}
    if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
      const resp = exceptionResponse as Record<string, unknown>;

      // Validation pipe errors (class-validator)
      if (Array.isArray(resp.message) && status === 400) {
        const errors: ValidationErrorDetail[] = (
          resp.message as string[]
        ).map((msg) => ({
          field: this.extractFieldFromMessage(msg),
          message: msg,
          code: 'INVALID_INPUT',
        }));

        return {
          message: 'Validation failed',
          code: ErrorCodes.VALIDATION_ERROR,
          statusCode: 400,
          errors,
        };
      }

      // Other structured responses from NestJS
      return {
        message:
          typeof resp.message === 'string'
            ? resp.message
            : 'An error occurred',
        code: this.httpStatusToCode(status),
        statusCode: status,
      };
    }

    // String response
    return {
      message:
        typeof exceptionResponse === 'string'
          ? exceptionResponse
          : 'An error occurred',
      code: this.httpStatusToCode(status),
      statusCode: status,
    };
  }

  /**
   * Handles completely unknown/unexpected errors.
   * Logs the full stack trace internally but NEVER exposes it in the response.
   */
  private handleUnknownError(
    exception: unknown,
    request: Request,
  ): ErrorResponse {
    const requestId = request.headers['x-request-id'] || 'unknown';

    if (exception instanceof Error) {
      this.logger.error(
        `Unhandled exception [${requestId}]: ${exception.message}`,
        exception.stack,
      );
    } else {
      try {
        this.logger.error(
          `Unhandled non-Error exception [${requestId}]: ${JSON.stringify(exception)}`,
        );
      } catch {
        this.logger.error(
          `Unhandled non-serializable exception [${requestId}]`,
        );
      }
    }

    return {
      message: 'An unexpected error occurred',
      code: ErrorCodes.INTERNAL_ERROR,
      statusCode: 500,
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /**
   * Extracts the field name from a PostgreSQL unique constraint violation.
   * Constraint names typically follow: uni_tablename_fieldname or idx_tablename_fieldname
   */
  private extractConstraintField(
    driverError: Record<string, unknown>,
  ): string | null {
    const constraint = driverError.constraint as string | undefined;
    if (!constraint) return null;

    // Try to extract field from constraint name patterns:
    // uni_users_email → email
    // idx_tickets_ticket_code → ticket_code
    const parts = constraint.split('_');
    if (parts.length >= 3) {
      // Skip prefix (uni/idx/uq) and table name, take the rest
      return parts.slice(2).join('_');
    }

    return constraint;
  }

  /**
   * Extracts field name from class-validator error messages.
   * Messages often start with the field name (e.g., "email must be an email").
   */
  private extractFieldFromMessage(message: string): string {
    const firstWord = message.split(' ')[0];
    return firstWord || 'unknown';
  }

  /**
   * Maps HTTP status codes to our ErrorCodes constants.
   */
  private httpStatusToCode(status: number): string {
    switch (status) {
      case 400:
        return ErrorCodes.BAD_REQUEST;
      case 401:
        return ErrorCodes.UNAUTHORIZED;
      case 403:
        return ErrorCodes.FORBIDDEN;
      case 404:
        return ErrorCodes.NOT_FOUND;
      case 409:
        return ErrorCodes.CONFLICT;
      case 429:
        return ErrorCodes.TOO_MANY_REQUESTS;
      default:
        return ErrorCodes.INTERNAL_ERROR;
    }
  }
}
