/**
 * Erro de domínio: mensagem para quem lê, `code` para quem programa, status
 * HTTP e, quando for validação, os erros por campo. O filtro global serializa.
 */

export const ErrorCodes = {
  BAD_REQUEST: 'BAD_REQUEST',
  NOT_FOUND: 'NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  CONFLICT: 'CONFLICT',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  PARSING_ERROR: 'PARSING_ERROR',
  /** Mutação sem o par cookie/header de CSRF (SPEC_CP20 RF-5). */
  CSRF_TOKEN_INVALID: 'CSRF_TOKEN_INVALID',

  SEAT_UNAVAILABLE: 'SEAT_UNAVAILABLE',
  STALE_UPDATE: 'STALE_UPDATE',
  TICKET_ALREADY_USED: 'TICKET_ALREADY_USED',
  INVALID_TICKET: 'INVALID_TICKET',
  LINK_EXPIRED: 'LINK_EXPIRED',
  LINK_ALREADY_USED: 'LINK_ALREADY_USED',
  EVENT_NOT_ACTIVE: 'EVENT_NOT_ACTIVE',
  HALF_PRICE_QUOTA_EXCEEDED: 'HALF_PRICE_QUOTA_EXCEEDED',
  EXTERNAL_SERVICE_UNAVAILABLE: 'EXTERNAL_SERVICE_UNAVAILABLE',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export interface ValidationErrorDetail {
  field: string;
  message: string;
  code: string;
  expected?: string;
  received?: string;
}

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly errors?: ValidationErrorDetail[];

  constructor(
    message: string,
    code: ErrorCode,
    statusCode: number,
    errors?: ValidationErrorDetail[],
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.errors = errors;

    Error.captureStackTrace(this, this.constructor);
  }
}

/** Assento já reservado ou vendido quando outro cliente tenta travá-lo. */
export class SeatUnavailableError extends AppError {
  constructor(seatId?: string) {
    const msg = seatId
      ? `Seat ${seatId} is no longer available`
      : 'The selected seat is no longer available';
    super(msg, ErrorCodes.SEAT_UNAVAILABLE, 409);
    this.name = 'SeatUnavailableError';
  }
}

/** O recurso mudou entre a leitura e a escrita. */
export class StaleUpdateError extends AppError {
  constructor(resource?: string) {
    const msg = resource
      ? `${resource} was modified by another request. Please retry.`
      : 'Resource was modified by another request. Please retry.';
    super(msg, ErrorCodes.STALE_UPDATE, 409);
    this.name = 'StaleUpdateError';
  }
}

/** Assinatura HMAC inválida ou payload malformado: não é ingresso nosso. */
export class TicketInvalidError extends AppError {
  constructor(reason?: string) {
    const msg = reason
      ? `Invalid ticket: ${reason}`
      : 'The submitted ticket is invalid';
    super(msg, ErrorCodes.INVALID_TICKET, 400);
    this.name = 'TicketInvalidError';
  }
}

/**
 * Fora da janela de entrada. Não muda o status do ingresso: chegar cedo não
 * pode queimar a entrada de ninguém.
 */
export class EventNotActiveError extends AppError {
  constructor(eventId?: string) {
    const msg = eventId
      ? `Event ${eventId} is not currently active for entry`
      : 'The event is not currently active for entry';
    super(msg, ErrorCodes.EVENT_NOT_ACTIVE, 400);
    this.name = 'EventNotActiveError';
  }
}

/** Link de compartilhamento passou das 48 horas. */
export class LinkExpiredError extends AppError {
  constructor() {
    super('This sharing link has expired', ErrorCodes.LINK_EXPIRED, 410);
    this.name = 'LinkExpiredError';
  }
}

/** Link já consumido. Tem prioridade sobre "expirado" quando valem os dois. */
export class LinkAlreadyUsedError extends AppError {
  constructor() {
    super(
      'This sharing link has already been used',
      ErrorCodes.LINK_ALREADY_USED,
      410,
    );
    this.name = 'LinkAlreadyUsedError';
  }
}

/** Ticketmaster ou TMDb fora do ar, lentos, ou vazios sem cache para servir. */
export class ExternalServiceError extends AppError {
  constructor(service?: string) {
    const msg = service
      ? `External service unavailable: ${service}`
      : 'External service is temporarily unavailable';
    super(msg, ErrorCodes.EXTERNAL_SERVICE_UNAVAILABLE, 503);
    this.name = 'ExternalServiceError';
  }
}
