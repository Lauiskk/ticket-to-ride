import { useState, useMemo, useCallback, memo } from 'react';
import { motion } from 'framer-motion';
import { HalfPriceSelector } from './HalfPriceSelector';
import { formatMoney } from '../lib/eventStatus';
import type { Seat, HalfPriceClaim } from '../types';


/**
 * One seat.
 *
 * Extracted and memoized because a large venue renders **a thousand** of these.
 * Before, each was a `motion.button`: a Framer Motion component with its own
 * animation subscription and per-frame work. Selecting a single seat re-rendered
 * all thousand, which is exactly what made the map feel frozen.
 *
 * A seat is a button. It only re-renders when its own status or selection
 * changes, and its feedback is a CSS transition — the browser handles that on
 * the compositor without React knowing.
 */
const SeatButton = memo(
  function SeatButton({
    seat,
    selected,
    sectionName,
    onToggle,
  }: {
    seat: Seat;
    selected: boolean;
    sectionName: string;
    onToggle: (seatId: string, status: string) => void;
  }) {
    const available = seat.status === 'available';

    const tone = selected
      ? 'bg-board-crimson text-white shadow-sm'
      : available
        ? 'bg-board-gold/80 hover:bg-board-gold cursor-pointer'
        : 'bg-board-navy/25 text-board-navy/40 cursor-not-allowed';

    return (
      <button
        type="button"
        disabled={!available && !selected}
        onClick={() => onToggle(seat.id, seat.status)}
        aria-pressed={selected}
        aria-label={`${sectionName}, fila ${seat.row}, assento ${seat.number}${available ? '' : ' (indisponível)'}`}
        title={`${sectionName} · Fila ${seat.row} · Assento ${seat.number}`}
        className={`w-8 h-8 rounded text-xs font-medium flex items-center justify-center
                    transition-[background-color,transform] duration-150 ease-out
                    active:scale-90 ${selected ? 'scale-105' : ''} ${tone}`}
      >
        {seat.number}
      </button>
    );
  },
  // Nothing else can change a seat's appearance
  (prev, next) =>
    prev.seat.id === next.seat.id &&
    prev.seat.status === next.seat.status &&
    prev.selected === next.selected,
);

interface SeatMapProps {
  seats: Seat[];
  price: number;
  /** Whether this event offers half-price tickets (SPEC_CP12). */
  halfPriceEnabled?: boolean;
  onReserve: (seatIds: string[], halfPriceClaims: HalfPriceClaim[]) => void;
  isReserving: boolean;
}

export function SeatMap({
  seats,
  price,
  halfPriceEnabled = false,
  onReserve,
  isReserving,
}: SeatMapProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [halfPriceClaims, setHalfPriceClaims] = useState<HalfPriceClaim[]>([]);
  const [halfPriceValid, setHalfPriceValid] = useState(true);

  // Group seats by section and row
  const sections = useMemo(() => {
    const map = new Map<string, Map<string, Seat[]>>();
    for (const seat of seats) {
      if (!map.has(seat.section)) map.set(seat.section, new Map());
      const section = map.get(seat.section)!;
      const rowKey = seat.row || 'GA';
      if (!section.has(rowKey)) section.set(rowKey, []);
      section.get(rowKey)!.push(seat);
    }
    // Sort seats in each row by number
    for (const section of map.values()) {
      for (const [key, rowSeats] of section.entries()) {
        section.set(key, rowSeats.sort((a, b) => Number(a.number || 0) - Number(b.number || 0)));
      }
    }
    return map;
  }, [seats]);

  // Stable identity: a new function every render would defeat the memo on all
  // thousand seats.
  const toggleSeat = useCallback((seatId: string, status: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(seatId)) {
        next.delete(seatId);
        return next;
      }
      // Only a free seat can be picked; deselecting is always allowed
      if (status !== 'available') return prev;
      next.add(seatId);
      return next;
    });
  }, []);

  // Preview only — the server recalculates from event.price (SPEC_CP12 RF-10)
  const halfCount = halfPriceClaims.length;
  const totalPrice = (selectedIds.size - halfCount) * price + halfCount * (price / 2);

  const selectedSeats = useMemo(
    () =>
      seats
        .filter((s) => selectedIds.has(s.id))
        .map((s) => ({
          id: s.id,
          label: `${s.section} · Fila ${s.row} · Assento ${s.number}`,
        })),
    [seats, selectedIds],
  );

  return (
    <div>
      {/* Stage indicator */}
      <div className="bg-board-navy text-board-parchment text-center py-2 rounded-t-lg text-sm font-medium mb-6">
        PALCO
      </div>

      {/* Seat grid by section */}
      {Array.from(sections.entries()).map(([sectionName, rows]) => (
        // `content-visibility` lets the browser skip layout/paint for sections
        // scrolled out of view — a 1000-seat venue is mostly off-screen.
        <div key={sectionName} className="mb-8 [content-visibility:auto] [contain-intrinsic-size:auto_320px]">
          <h3 className="font-display text-lg font-semibold text-board-navy mb-3">{sectionName}</h3>
          <div className="space-y-2">
            {Array.from(rows.entries()).map(([rowName, rowSeats]) => (
              <div key={rowName} className="flex items-center gap-1">
                <span className="w-8 text-xs text-board-navy/50 font-medium">{rowName}</span>
                <div className="flex gap-1 flex-wrap">
                  {rowSeats.map((seat) => (
                    <SeatButton
                      key={seat.id}
                      seat={seat}
                      selected={selectedIds.has(seat.id)}
                      sectionName={sectionName}
                      onToggle={toggleSeat}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Legend */}
      <div className="flex gap-4 justify-center text-xs text-board-navy/60 my-4">
        <div className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-board-gold/80" /> Disponível</div>
        <div className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-board-crimson" /> Selecionado</div>
        <div className="flex items-center gap-1"><span className="w-4 h-4 rounded bg-board-navy/30" /> Indisponível</div>
      </div>

      {/* Selection summary */}
      {selectedIds.size > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-6 p-4 bg-board-parchment rounded-lg border border-board-gold/30"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="font-medium text-board-navy">
              {selectedIds.size} assento{selectedIds.size > 1 ? 's' : ''} selecionado{selectedIds.size > 1 ? 's' : ''}
            </span>
            <span className="font-display text-xl font-bold text-board-crimson">
              {formatMoney(totalPrice)}
            </span>
          </div>
          {halfPriceEnabled && (
            <HalfPriceSelector
              seats={selectedSeats}
              price={price}
              currency="BRL"
              onChange={(claims, valid) => {
                setHalfPriceClaims(claims);
                setHalfPriceValid(valid);
              }}
            />
          )}

          <button
            onClick={() => onReserve(Array.from(selectedIds), halfPriceClaims)}
            disabled={isReserving || !halfPriceValid}
            className="btn-primary w-full mt-4 disabled:opacity-50"
          >
            {isReserving
              ? 'Reservando...'
              : !halfPriceValid
                ? 'Complete os dados da meia-entrada'
                : 'Reservar assentos'}
          </button>
        </motion.div>
      )}
    </div>
  );
}
