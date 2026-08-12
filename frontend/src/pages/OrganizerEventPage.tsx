import { Link, useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useAvailableSeats } from '../hooks/useEvents';
import { useSeatSocket } from '../hooks/useSeatSocket';
import { useEventActions } from '../hooks/useEventActions';
import { OccupancyMap } from '../components/organizer/OccupancyMap';
import { EventMetricsPanel } from '../components/organizer/EventMetricsPanel';
import {
  EVENT_STATUS_LABEL,
  EVENT_STATUS_CLASS,
  PUBLISH_ACTION_LABEL,
} from '../lib/eventStatus';
import type { EventMetrics } from '../types';

/**
 * One event, from the box office (SPEC_CP17 RF-2).
 *
 * The organizer used to reach their own event through the storefront and land
 * on the buyer's page: a seat map asking them to pick a seat and pay for it.
 * This is the same room drawn for the other side of the counter — how it is
 * filling, section by section, and the two decisions that are theirs to make.
 *
 * Ownership is enforced by the server: `/events/:id/metrics` runs the event
 * through `findOwnedEvent` and answers 404 for someone else's event, so a
 * mistyped id lands on "não encontrado", never on another promoter's numbers.
 */
export function OrganizerEventPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const {
    data: metrics,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['event-metrics', id],
    queryFn: async () => {
      const res = await api.get<EventMetrics>(`/events/${id}/metrics`);
      return res.data;
    },
    enabled: !!id,
  });

  const { data: seats } = useAvailableSeats(id);
  // Someone buying right now moves a square on this screen, live.
  useSeatSocket(id);

  const { putOnSale, cancelEvent, busyId, error } = useEventActions();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-board-cream py-12 px-4">
        <div className="max-w-4xl mx-auto card-game p-8 animate-pulse space-y-4">
          <div className="h-8 bg-board-parchment-dark/30 rounded w-2/3" />
          <div className="h-4 bg-board-parchment-dark/20 rounded w-1/3" />
          <div className="h-64 bg-board-parchment-dark/20 rounded mt-6" />
        </div>
      </div>
    );
  }

  if (isError || !metrics) {
    return (
      <div className="min-h-screen bg-board-cream py-12 px-4 text-center">
        <p className="text-board-crimson text-lg mt-20 mb-4">Evento não encontrado.</p>
        <Link to="/organizer" className="btn-primary inline-block">
          Voltar ao painel
        </Link>
      </div>
    );
  }

  const isDraft = metrics.status === 'draft';
  const busy = busyId === id;

  return (
    <div className="min-h-screen bg-board-cream py-10 px-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-4xl mx-auto">
        <Link
          to="/organizer"
          className="inline-flex items-center gap-1 text-board-navy/50 hover:text-board-navy text-sm mb-4 transition-colors"
        >
          ← Painel
        </Link>

        {/* Header — what this event is, and the decisions that are yours */}
        <div className="card-game p-6 mb-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="font-display text-2xl font-bold text-board-navy leading-tight">
                {metrics.title}
              </h1>
              <span
                className={`inline-block mt-2 px-2.5 py-1 rounded-full text-xs font-semibold ${EVENT_STATUS_CLASS[metrics.status]}`}
              >
                {EVENT_STATUS_LABEL[metrics.status]}
              </span>
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              {isDraft && (
                <button
                  onClick={() => id && putOnSale(id)}
                  disabled={busy}
                  className="btn-gold text-sm py-2 px-4 disabled:opacity-50"
                >
                  {busy ? '...' : PUBLISH_ACTION_LABEL}
                </button>
              )}
              {metrics.status !== 'cancelled' && (
                <button
                  onClick={async () => {
                    if (!id) return;
                    const done = await cancelEvent(id, metrics.title, metrics.status);
                    // Um rascunho descartado não tem mais tela própria
                    if (done && isDraft) navigate('/organizer');
                  }}
                  disabled={busy}
                  className={`text-sm hover:underline disabled:opacity-50 ${
                    isDraft ? 'text-board-navy/50 hover:text-board-crimson' : 'text-board-crimson'
                  }`}
                >
                  {isDraft ? 'Descartar' : 'Cancelar evento'}
                </button>
              )}
            </div>
          </div>

          {isDraft && (
            <p className="mt-4 text-sm text-board-navy/60 bg-board-parchment/60 rounded-lg px-3 py-2.5">
              Rascunho: este evento <strong>ainda não aparece</strong> para os clientes. Confira a
              planta da casa abaixo e coloque à venda quando estiver pronto.
            </p>
          )}

          {error && (
            <p role="alert" className="mt-4 text-sm text-board-crimson">
              {error}
            </p>
          )}

          {/* Os mesmos números do painel, sem precisar expandir nada */}
          {id && <EventMetricsPanel eventId={id} />}
        </div>

        {/* A casa */}
        <div className="card-game p-6">
          <h2 className="font-display text-xl font-semibold text-board-navy mb-1">
            Mapa de ocupação
          </h2>
          <p className="text-board-navy/50 text-sm mb-6">
            Onde os lugares foram vendidos. Esta tela é só de leitura — organizador não compra
            ingresso do próprio evento.
          </p>
          <OccupancyMap seats={seats ?? []} />
        </div>
      </motion.div>
    </div>
  );
}
