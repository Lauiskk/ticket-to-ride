/**
 * Standardized error response structure.
 * Replicates the Go project's CustomError pattern:
 * - message: human-readable error message
 * - code: machine-readable string constant (from ErrorCodes)
 * - statusCode: HTTP status code
 * - errors: optional array of field-level validation errors
 *
 * The GlobalExceptionFilter catches these and serializes them
 * into the standardized JSON response format.
 */

// ─── Error Codes ──────────────────────────────────────────────────────────────

export const ErrorCodes = {
  // Generic
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

  // Domain-specific
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

// ─── Validation Error Detail ──────────────────────────────────────────────────

export interface ValidationErrorDetail {
  field: string;
  message: string;
  code: string;
  expected?: string;
  received?: string;
}

// ─── Base AppError ────────────────────────────────────────────────────────────

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

    // Maintains proper stack trace in V8
    Error.captureStackTrace(this, this.constructor);
  }
}

// ─── Domain-Specific Error Subclasses ─────────────────────────────────────────

/**
 * Thrown when a seat is already reserved/sold and another client tries to lock it.
 * HTTP 409 — the request conflicts with the current resource state.
 */
export class SeatUnavailableError extends AppError {
  constructor(seatId?: string) {
    const msg = seatId
      ? `Seat ${seatId} is no longer available`
      : 'The selected seat is no longer available';
    super(msg, ErrorCodes.SEAT_UNAVAILABLE, 409);
    this.name = 'SeatUnavailableError';
  }
}

/**
 * Thrown when an optimistic concurrency check fails (version mismatch).
 * HTTP 409 — the resource was modified by another request between read and write.
 */
export class StaleUpdateError extends AppError {
  constructor(resource?: string) {
    const msg = resource
      ? `${resource} was modified by another request. Please retry.`
      : 'Resource was modified by another request. Please retry.';
    super(msg, ErrorCodes.STALE_UPDATE, 409);
    this.name = 'StaleUpdateError';
  }
}

/**
 * Thrown when a ticket's HMAC signature is invalid or the payload is malformed.
 * HTTP 400 — the submitted data is not a valid ticket.
 */
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
 * Thrown when a gate operator tries to validate a ticket for an event
 * that hasn't started yet or has already ended (beyond grace period).
 * HTTP 400 — the event is not in its active validation window.
 * IMPORTANT: This does NOT change the ticket status (Req 11.7).
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

/**
 * Thrown when a sharing link has passed its 48-hour expiry window.
 * HTTP 410 — the resource is gone (expired).
 */
export class LinkExpiredError extends AppError {
  constructor() {
    super('This sharing link has expired', ErrorCodes.LINK_EXPIRED, 410);
    this.name = 'LinkExpiredError';
  }
}

/**
 * Thrown when a sharing link has already been used to transfer a ticket.
 * HTTP 410 — the resource is gone (consumed).
 * NOTE: This takes priority over LinkExpiredError when both conditions are true (Req 10.5).
 */
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

/**
 * Thrown when an external API (Ticketmaster, TMDb) fails, times out,
 * or returns empty results and no cache is available.
 * HTTP 503 — the upstream service is temporarily unavailable.
 */
export class ExternalServiceError extends AppError {
  constructor(service?: string) {
    const msg = service
      ? `External service unavailable: ${service}`
      : 'External service is temporarily unavailable';
    super(msg, ErrorCodes.EXTERNAL_SERVICE_UNAVAILABLE, 503);
    this.name = 'ExternalServiceError';
  }
}
