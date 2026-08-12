import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';

/**
 * HMAC-SHA256 ticket signing and verification service (Req 9.2, 11.1).
 *
 * The ticket payload is signed with a server-side secret key.
 * The Gate can verify the signature without external calls.
 *
 * Payload fields: ticketId, eventId, seatIdentifier, issuedAt
 * NO PII (no user name, email, phone) — Req 9.4
 */

export interface TicketPayload {
  ticketId: string;
  eventId: string;
  seatIdentifier: string;
  issuedAt: number; // Unix timestamp
}

@Injectable()
export class TicketSignerService {
  private readonly secret: string;

  constructor(private readonly configService: ConfigService) {
    this.secret = this.configService.get<string>('ticket.signingSecret') || '';
  }

  /**
   * Sign a ticket payload producing an HMAC-SHA256 hex signature.
   */
  sign(payload: TicketPayload): string {
    const data = this.serializePayload(payload);
    return createHmac('sha256', this.secret).update(data).digest('hex');
  }

  /**
   * Verify a ticket payload against a signature.
   * Returns true if valid, false if tampered.
   */
  verify(payload: TicketPayload, signature: string): boolean {
    const expected = this.sign(payload);
    // Constant-time comparison to prevent timing attacks
    if (expected.length !== signature.length) return false;
    let result = 0;
    for (let i = 0; i < expected.length; i++) {
      result |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
    }
    return result === 0;
  }

  /**
   * Serialize payload to a deterministic string for signing.
   * Order matters — must be identical at sign and verify time.
   */
  private serializePayload(payload: TicketPayload): string {
    return `${payload.ticketId}:${payload.eventId}:${payload.seatIdentifier}:${payload.issuedAt}`;
  }

  /**
   * Encode a signed ticket into the full QR payload string.
   * This is what gets encoded into the QR code image.
   */
  encodeQrPayload(payload: TicketPayload, signature: string): string {
    return JSON.stringify({
      tid: payload.ticketId,
      eid: payload.eventId,
      seat: payload.seatIdentifier,
      iat: payload.issuedAt,
      sig: signature,
    });
  }

  /**
   * Decode a QR payload string back into payload + signature.
   * Returns null if the string is malformed.
   */
  decodeQrPayload(qrString: string): { payload: TicketPayload; signature: string } | null {
    try {
      const parsed = JSON.parse(qrString);
      if (!parsed.tid || !parsed.eid || !parsed.seat || !parsed.iat || !parsed.sig) {
        return null;
      }
      return {
        payload: {
          ticketId: parsed.tid,
          eventId: parsed.eid,
          seatIdentifier: parsed.seat,
          issuedAt: parsed.iat,
        },
        signature: parsed.sig,
      };
    } catch {
      return null;
    }
  }
}
