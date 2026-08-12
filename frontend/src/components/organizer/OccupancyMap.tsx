import { useMemo } from 'react';
import { groupSeats } from '../../lib/seatGroups';
import type { Seat } from '../../types';

/**
 * The house, seen from the box office (SPEC_CP17 RF-3).
 *
 * Same plan as the buyer's `SeatMap` — deliberately, so the organizer is
 * looking at the room their audience sees — but this one answers a different
 * question. The buyer asks "where can I sit"; the organizer asks "which part of
 * the room is not selling". So the colours mean sold / held / free, and there is
 * nothing to click: no selection, no total, no reserve button. Someone running
 * an event should not be able to buy into it by accident.
 *
 * Plain divs, no animation components: a thousand seats brought the buyer's map
 * to a crawl once already (CP16), and this one draws exactly the same amount.
 */

const TONE: Record<Seat['status'], string> = {
  sold: 'bg-board-emerald text-white',
  reserved: 'bg-board-gold text-board-navy',
  available: 'bg-board-parchment-dark/60 text-board-navy/45',
};

const LEGEND: Array<{ status: Seat['status']; label: string }> = [
  { status: 'sold', label: 'Vendido' },
  { status: 'reserved', label: 'Em reserva' },
  { status: 'available', label: 'Livre' },
];

export function OccupancyMap({ seats }: { seats: Seat[] }) {
  const sections = useMemo(() => groupSeats(seats), [seats]);

  if (seats.length === 0) {
    return (
      <p className="text-board-navy/50 text-sm py-8 text-center">
        Este evento ainda não tem assentos configurados.
      </p>
    );
  }

  return (
    <div>
      <div className="bg-board-navy text-board-parchment text-center py-2 rounded-t-lg text-sm font-medium mb-6">
        PALCO
      </div>

      {Array.from(sections.entries()).map(([sectionName, rows]) => {
        const sectionSeats = Array.from(rows.values()).flat();
        const sold = sectionSeats.filter((s) => s.status === 'sold').length;

        return (
          <div
            key={sectionName}
            className="mb-8 [content-visibility:auto] [contain-intrinsic-size:auto_320px]"
          >
            <div className="flex items-baseline justify-between gap-3 mb-3">
              <h3 className="font-display text-lg font-semibold text-board-navy">{sectionName}</h3>
              <span className="text-board-navy/50 text-sm font-ticket">
                {sold}/{sectionSeats.length} vendidos
              </span>
            </div>

            <div className="space-y-2">
              {Array.from(rows.entries()).map(([rowName, rowSeats]) => (
                <div key={rowName} className="flex items-center gap-1">
                  {/* Pista não tem fileira — não inventa uma coluna vazia */}
                  {rowName !== 'GA' && (
                    <span className="w-8 text-xs text-board-navy/50 font-medium">{rowName}</span>
                  )}
                  <div className="flex gap-1 flex-wrap">
                    {rowSeats.map((seat) => (
                      <span
                        key={seat.id}
                        title={`${sectionName}${seat.row ? ` · Fila ${seat.row}` : ''} · Assento ${seat.number}`}
                        className={`w-8 h-8 rounded text-xs font-medium flex items-center justify-center ${TONE[seat.status]}`}
                      >
                        {seat.number}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      <div className="flex gap-4 justify-center text-xs text-board-navy/60 my-4">
        {LEGEND.map(({ status, label }) => (
          <span key={status} className="flex items-center gap-1.5">
            <span className={`w-4 h-4 rounded ${TONE[status]}`} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
