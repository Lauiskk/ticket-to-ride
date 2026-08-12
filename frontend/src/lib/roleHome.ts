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
 */
export function isStoreBlocked(role: UserRole | undefined): boolean {
  return role === 'gate';
}
