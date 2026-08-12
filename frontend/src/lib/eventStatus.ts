import type { EventStatus } from '../types';

/**
 * Event status vocabulary (SPEC_CP12 RF-5).
 *
 * The API speaks `draft`/`published`/`cancelled` — publishing language borrowed
 * from blogs. A box office has its own words: an event is a draft, then it is
 * on sale, then it is cancelled. "Publicar" told the organizer nothing about
 * what actually happens (tickets become buyable).
 */
export const EVENT_STATUS_LABEL: Record<EventStatus, string> = {
  draft: 'Rascunho',
  published: 'À venda',
  cancelled: 'Cancelado',
};

export const EVENT_STATUS_CLASS: Record<EventStatus, string> = {
  draft: 'bg-board-parchment-dark text-board-navy/70',
  published: 'bg-board-emerald/20 text-board-emerald',
  cancelled: 'bg-board-crimson/15 text-board-crimson',
};

/** What the button does, said plainly. */
export const PUBLISH_ACTION_LABEL = 'Colocar à venda';

export function formatMoney(value: number, currency = 'BRL'): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value);
}
