import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Event } from '../types';

/**
 * The two things a promoter does to an event: put it on sale, or call it off.
 *
 * Shared by the panel and by the event's own screen so the wording and the
 * confirmation never drift apart between the two places they appear.
 */
export function useEventActions() {
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(
    async (eventId?: string) => {
      await queryClient.invalidateQueries({ queryKey: ['my-events'] });
      if (eventId) {
        await queryClient.invalidateQueries({ queryKey: ['event-metrics', eventId] });
      }
    },
    [queryClient],
  );

  const putOnSale = useCallback(
    async (eventId: string) => {
      setBusyId(eventId);
      setError('');
      try {
        await api.patch(`/events/${eventId}/publish`);
        await refresh(eventId);
      } catch (err: any) {
        setError(err.message || 'Não foi possível colocar à venda.');
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  /**
   * Drafts and live events go through the same endpoint, but they are not the
   * same act: a draft has no buyers, so it is simply discarded. Calling that
   * "cancelar o evento" would suggest someone out there needs a refund.
   */
  const cancelEvent = useCallback(
    async (eventId: string, title: string, status: Event['status']): Promise<boolean> => {
      const isDraft = status === 'draft';

      const confirmed = confirm(
        isDraft
          ? `Descartar o rascunho "${title}"? Ele não está à venda, então ninguém é afetado.`
          : `Cancelar "${title}"? Quem já comprou precisará ser reembolsado.`,
      );
      if (!confirmed) return false;

      setBusyId(eventId);
      setError('');
      try {
        await api.patch(`/events/${eventId}/cancel`);
        await refresh(eventId);
        return true;
      } catch (err: any) {
        setError(
          err.message || (isDraft ? 'Não foi possível descartar.' : 'Não foi possível cancelar.'),
        );
        return false;
      } finally {
        setBusyId(null);
      }
    },
    [refresh],
  );

  return { putOnSale, cancelEvent, busyId, error, setError };
}
