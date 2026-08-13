import * as fc from 'fast-check';
import { TicketSignerService, TicketPayload } from './ticket-signer.service';

/**
 * Property tests for TicketSignerService (Properties 24, 25).
 *
 * Property 24: HMAC Ticket Sign/Verify Round-Trip
 * - sign then verify same payload → true
 * - tamper any field → false
 *
 * Property 25: QR Payload Structure (No PII)
 * - Parsed QR contains ONLY: tid, eid, seat, iat, sig
 * - NEVER contains names, emails, phones
 */

describe('TicketSignerService', () => {
  let service: TicketSignerService;

  beforeAll(() => {
    const mockConfig = {
      get: jest.fn().mockReturnValue('test-secret-key-minimum-32-chars-long'),
    } as any;
    service = new TicketSignerService(mockConfig);
  });

  describe('Property 24: HMAC Sign/Verify Round-Trip', () => {
    it('signing then verifying the same payload returns true', () => {
      fc.assert(
        fc.property(
          fc.record({
            ticketId: fc.uuid(),
            eventId: fc.uuid(),
            seatIdentifier: fc.string({ minLength: 1, maxLength: 50 }).filter(s => !s.includes(':')),
            issuedAt: fc.integer({ min: 1000000000, max: 2000000000 }),
          }),
          (payload: TicketPayload) => {
            const signature = service.sign(payload);
            expect(service.verify(payload, signature)).toBe(true);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('modifying any field makes verification fail', () => {
      fc.assert(
        fc.property(
          fc.record({
            ticketId: fc.uuid(),
            eventId: fc.uuid(),
            seatIdentifier: fc.string({ minLength: 1, maxLength: 50 }).filter(s => !s.includes(':')),
            issuedAt: fc.integer({ min: 1000000000, max: 2000000000 }),
          }),
          fc.integer({ min: 0, max: 3 }),
          (payload: TicketPayload, fieldToTamper: number) => {
            const signature = service.sign(payload);

            // Tamper one field
            const tampered = { ...payload };
            switch (fieldToTamper) {
              case 0:
                tampered.ticketId = tampered.ticketId + 'x';
                break;
              case 1:
                tampered.eventId = tampered.eventId + 'x';
                break;
              case 2:
                tampered.seatIdentifier = tampered.seatIdentifier + 'x';
                break;
              case 3:
                tampered.issuedAt = tampered.issuedAt + 1;
                break;
            }

            expect(service.verify(tampered, signature)).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('modifying the signature makes verification fail', () => {
      fc.assert(
        fc.property(
          fc.record({
            ticketId: fc.uuid(),
            eventId: fc.uuid(),
            seatIdentifier: fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes(':')),
            issuedAt: fc.integer({ min: 1000000000, max: 2000000000 }),
          }),
          (payload: TicketPayload) => {
            const signature = service.sign(payload);
            // Flip one character in the signature
            const tampered = signature.slice(0, -1) + (signature.slice(-1) === 'a' ? 'b' : 'a');
            expect(service.verify(payload, tampered)).toBe(false);
          },
        ),
        { numRuns: 100 },
      );
    });
  });

  describe('Property 25: QR Payload Structure (No PII)', () => {
    it('encoded QR contains only tid, eid, seat, iat, sig — no PII', () => {
      fc.assert(
        fc.property(
          fc.record({
            ticketId: fc.uuid(),
            eventId: fc.uuid(),
            seatIdentifier: fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes(':')),
            issuedAt: fc.integer({ min: 1000000000, max: 2000000000 }),
          }),
          (payload: TicketPayload) => {
            const signature = service.sign(payload);
            const qrString = service.encodeQrPayload(payload, signature);

            // Parse the QR payload
            const parsed = JSON.parse(qrString);

            // Must have exactly these fields
            expect(Object.keys(parsed).sort()).toEqual(['eid', 'iat', 'seat', 'sig', 'tid']);

            // Values are correct
            expect(parsed.tid).toBe(payload.ticketId);
            expect(parsed.eid).toBe(payload.eventId);
            expect(parsed.seat).toBe(payload.seatIdentifier);
            expect(parsed.iat).toBe(payload.issuedAt);
            expect(typeof parsed.sig).toBe('string');
            expect(parsed.sig.length).toBeGreaterThan(0);

            // No PII fields.
            //
            // This has to be asserted on the KEYS, not on the serialized string.
            // Scanning the whole JSON for "name"/"email"/"@" also inspects the
            // seat identifier, which is free text an organizer controls — a
            // section called "Camarote Name" or a stage named "@Live" would fail
            // a payload that carries no PII at all. fast-check found exactly
            // that: seatIdentifier "name-0-1".
            const piiKey = /e-?mail|name|nome|phone|telefone|cpf|document/i;
            for (const key of Object.keys(parsed)) {
              expect(key).not.toMatch(piiKey);
            }

            // And the only free-text value present is the seat we passed in
            expect(parsed.seat).toBe(payload.seatIdentifier);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('decodeQrPayload round-trips correctly', () => {
      fc.assert(
        fc.property(
          fc.record({
            ticketId: fc.uuid(),
            eventId: fc.uuid(),
            seatIdentifier: fc.string({ minLength: 1, maxLength: 20 }).filter(s => !s.includes(':')),
            issuedAt: fc.integer({ min: 1000000000, max: 2000000000 }),
          }),
          (payload: TicketPayload) => {
            const signature = service.sign(payload);
            const qrString = service.encodeQrPayload(payload, signature);

            const decoded = service.decodeQrPayload(qrString);
            expect(decoded).not.toBeNull();
            expect(decoded!.payload).toEqual(payload);
            expect(decoded!.signature).toBe(signature);
          },
        ),
        { numRuns: 100 },
      );
    });

    it('decodeQrPayload returns null for invalid JSON', () => {
      expect(service.decodeQrPayload('not-json')).toBeNull();
      expect(service.decodeQrPayload('{}')).toBeNull();
      expect(service.decodeQrPayload('{"tid":"x"}')).toBeNull();
    });
  });
});
