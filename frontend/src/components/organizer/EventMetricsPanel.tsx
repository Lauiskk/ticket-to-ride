import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { api } from '../../lib/api';
import { formatMoney } from '../../lib/eventStatus';
import type { EventMetrics } from '../../types';

/**
 * Sales panel for one event (SPEC_CP12 RF-7).
 *
 * The organizer's question is not "list my rows" — it is "how full is the room
 * and how much came in". So the occupancy bar is the biggest thing here, split
 * into sold / held / free, and the per-section bars underneath answer the
 * follow-up: which part of the house is not moving.
 *
 * Nothing on this screen offers to buy anything: the organizer is running the
 * event, not shopping for it.
 */
export function EventMetricsPanel({ eventId }: { eventId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['event-metrics', eventId],
    queryFn: async () => {
      const res = await api.get<EventMetrics>(`/events/${eventId}/metrics`);
      return res.data;
    },
  });

  if (isLoading) {
    return (
      <div className="mt-4 pt-4 border-t border-board-parchment-dark space-y-3">
        <div className="h-3 bg-board-parchment-dark/40 rounded animate-pulse" />
        <div className="h-16 bg-board-parchment-dark/30 rounded animate-pulse" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <p className="mt-4 pt-4 border-t border-board-parchment-dark text-board-crimson text-sm">
        Não foi possível carregar as métricas deste evento.
      </p>
    );
  }

  const pct = (n: number) => (data.seatsTotal === 0 ? 0 : (n / data.seatsTotal) * 100);

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      className="mt-4 pt-4 border-t border-board-parchment-dark overflow-hidden"
    >
      {/* Occupancy — sold vs held vs free, in one bar */}
      <div className="mb-5">
        <div className="flex items-baseline justify-between mb-2">
          <span className="text-sm text-board-navy/60">Ocupação da casa</span>
          <span className="font-display text-2xl font-bold text-board-navy">
            {data.occupancyRate}%
          </span>
        </div>

        <div
          className="flex h-3 rounded-full overflow-hidden bg-board-parchment-dark"
          role="img"
          aria-label={`${data.seatsSold} vendidos, ${data.seatsReserved} em reserva, ${data.seatsAvailable} disponíveis`}
        >
          <div className="bg-board-emerald" style={{ width: `${pct(data.seatsSold)}%` }} />
          <div className="bg-board-gold" style={{ width: `${pct(data.seatsReserved)}%` }} />
        </div>

        <div className="flex flex-wrap gap-4 mt-2 text-xs text-board-navy/60">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-board-emerald" />
            {data.seatsSold} vendidos
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-board-gold" />
            {data.seatsReserved} em reserva
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-board-parchment-dark" />
            {data.seatsAvailable} livres
          </span>
        </div>
      </div>

      {/* Numbers */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        {[
          { label: 'Receita', value: formatMoney(data.revenue, data.currency), strong: true },
          { label: 'Ingressos emitidos', value: String(data.ticketsIssued) },
          { label: 'Já entraram', value: `${data.ticketsValidated}/${data.ticketsIssued}` },
          { label: 'Meias-entradas', value: String(data.halfPriceTickets) },
        ].map((stat) => (
          <div key={stat.label} className="bg-board-parchment/50 rounded-lg px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-wide text-board-navy/45">{stat.label}</p>
            <p
              className={`font-display font-bold text-board-navy mt-0.5 ${
                stat.strong ? 'text-xl' : 'text-lg'
              }`}
            >
              {stat.value}
            </p>
          </div>
        ))}
      </div>

      {/* Which part of the house is not moving */}
      {data.bySection.length > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-wide text-board-navy/45 mb-2">
            Por setor
          </p>
          <div className="space-y-2">
            {data.bySection.map((s) => {
              const sectionPct = s.total === 0 ? 0 : Math.round((s.sold / s.total) * 100);
              return (
                <div key={s.section} className="flex items-center gap-3">
                  <span className="w-32 sm:w-40 flex-shrink-0 text-sm text-board-navy truncate">
                    {s.section}
                  </span>
                  <div className="flex-1 h-2 rounded-full bg-board-parchment-dark overflow-hidden">
                    <div className="h-full bg-board-emerald" style={{ width: `${sectionPct}%` }} />
                  </div>
                  <span className="w-20 text-right text-xs text-board-navy/50 font-ticket">
                    {s.sold}/{s.total}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </motion.div>
  );
}
