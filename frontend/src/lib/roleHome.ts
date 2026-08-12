import type { UserRole } from '../types';

/**
 * Where each role belongs when it lands somewhere it shouldn't (SPEC_CP11 RF-3).
 *
 * Previously every wrong-role redirect went to `/events` — which for a gate
 * operator is precisely the storefront we are trying to keep them out of, and
 * for an organizer is a page that invites them to buy their own tickets.
 */
export function roleHome(role: UserRole | undefined): string {
  switch (role) {
    case 'gate':
      return '/gate';
    case 'organizer':
      return '/organizer';
    case 'client':
      return '/events';
    default:
      return '/';
  }
}

/**
 * Roles kept out of the storefront entirely (SPEC_CP11 RF-1).
 *
 * Only the gate: it is an operational device standing at a door, and every
 * second spent on a catalogue is a second not spent reading tickets.
 *
 * The organizer was briefly in this list (CP17) and it was the wrong call —
 * people testing it said they could not get back to the start and that there
 * was nowhere else to go. Blocking the store confused two different things:
 * **not being able to buy** and **not being able to look**. Only the first is
 * true, and it is `canBuyTickets` that says so (SPEC_CP19 RF-1).
 */
export function isStoreBlocked(role: UserRole | undefined): boolean {
  return role === 'gate';
}

/**
 * Who the checkout is actually for.
 *
 * `POST /reservations` is `@Roles(CLIENT)`, so an organizer clicking "Reservar"
 * gets a refusal after choosing seats. A visitor with no account counts as a
 * buyer — they just have to sign in first, which the flow already handles.
 */
export function canBuyTickets(role: UserRole | undefined): boolean {
  return role === undefined || role === 'client';
}
