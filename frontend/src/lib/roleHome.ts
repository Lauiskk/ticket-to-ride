import type { UserRole } from '../types';

/**
 * Para onde mandar cada papel que caiu onde não devia. Antes tudo ia para
 * `/events`, que para a portaria é justamente a loja da qual queremos mantê-la
 * longe.
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
 * Quem fica fora da loja: só a portaria, que é um aparelho parado numa porta.
 *
 * O organizador esteve nesta lista (CP17) e foi erro: quem testou ficou sem
 * saída. Bloquear a loja confundia não poder COMPRAR com não poder OLHAR — só
 * o primeiro é verdade, e quem diz isso é `canBuyTickets`.
 */
export function isStoreBlocked(role: UserRole | undefined): boolean {
  return role === 'gate';
}

/**
 * Para quem o checkout existe. `POST /reservations` é `@Roles(CLIENT)`: sem
 * isto, o organizador escolhia assentos para receber uma recusa no fim. Quem
 * não tem conta conta como comprador — só precisa entrar antes.
 */
export function canBuyTickets(role: UserRole | undefined): boolean {
  return role === undefined || role === 'client';
}
