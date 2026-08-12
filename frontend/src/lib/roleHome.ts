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
 * Roles that have no business in the buying flow (home, catalogue, event page).
 * The backend already rejects their purchase calls; this keeps the UI honest.
 *
 * The organizer joined the gate here (SPEC_CP17 RF-1). They were landing on the
 * storefront, opening their own event and finding the buyer's seat map with a
 * "Reservar assentos" button — which `POST /reservations` refuses
 * (`@Roles(UserRole.CLIENT)`), but only after they picked seats and clicked.
 * Offering a door that is locked is worse than not showing the door.
 *
 * A visitor with no account is NOT blocked: the storefront is public, and that
 * is the whole point of it.
 */
export function isStoreBlocked(role: UserRole | undefined): boolean {
  return role === 'gate' || role === 'organizer';
}
