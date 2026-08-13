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
 * Traduz qualquer exceção para o mesmo formato de erro. Stack nunca sai na
 * resposta, e resposta de erro nunca carrega metadados de paginação.
 */

interface ErrorResponse {
  message: string;
  code: string;
  statusCode: number;
  errors?: ValidationErrorDetail[];
}

/** Violação de unicidade no Postgres. */
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
    if (exception instanceof AppError) {
      return this.handleAppError(exception);
    }

    if (exception instanceof QueryFailedError) {
      return this.handleQueryFailedError(exception);
    }

    if (exception instanceof HttpException) {
      return this.handleHttpException(exception);
    }

    // Desconhecido: loga a stack, nunca devolve
    return this.handleUnknownError(exception, request);
  }

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

  /** Violação de unicidade vira 409 com o nome do campo em conflito. */
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

  private handleHttpException(exception: HttpException): ErrorResponse {
    const status = exception.getStatus();
    const exceptionResponse = exception.getResponse();

    if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
      const resp = exceptionResponse as Record<string, unknown>;

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

      return {
        message:
          typeof resp.message === 'string'
            ? resp.message
            : 'An error occurred',
        code: this.httpStatusToCode(status),
        statusCode: status,
      };
    }

    return {
      message:
        typeof exceptionResponse === 'string'
          ? exceptionResponse
          : 'An error occurred',
      code: this.httpStatusToCode(status),
      statusCode: status,
    };
  }

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

  /** `uni_users_email` → `email`. */
  private extractConstraintField(
    driverError: Record<string, unknown>,
  ): string | null {
    const constraint = driverError.constraint as string | undefined;
    if (!constraint) return null;

    const parts = constraint.split('_');
    if (parts.length >= 3) {
      return parts.slice(2).join('_');
    }

    return constraint;
  }

  /** A mensagem do class-validator começa pelo campo: "email must be an email". */
  private extractFieldFromMessage(message: string): string {
    const firstWord = message.split(' ')[0];
    return firstWord || 'unknown';
  }

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
