import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import type { Seat } from '../types';

interface SeatMapProps {
  seats: Seat[];
  price: number;
  currency: string;
  onReserve: (seatIds: string[]) => void;
  isReserving: boolean;
}

export function SeatMap({ seats, price, currency, onReserve, isReserving }: SeatMapProps) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

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

  const toggleSeat = (seatId: string, status: string) => {
    if (status !== 'available') return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(seatId)) next.delete(seatId);
      else next.add(seatId);
      return next;
    });
  };

  const getSeatColor = (seat: Seat) => {
    if (selectedIds.has(seat.id)) return 'bg-board-crimson text-white shadow-md scale-110';
    if (seat.status === 'available') return 'bg-board-gold/80 hover:bg-board-gold cursor-pointer hover:scale-105';
    return 'bg-board-navy/30 cursor-not-allowed opacity-50';
  };

  const totalPrice = selectedIds.size * price;

  return (
    <div>
      {/* Stage indicator */}
      <div className="bg-board-navy text-board-parchment text-center py-2 rounded-t-lg text-sm font-medium mb-6">
        PALCO
      </div>

      {/* Seat grid by section */}
      {Array.from(sections.entries()).map(([sectionName, rows]) => (
        <div key={sectionName} className="mb-8">
          <h3 className="font-display text-lg font-semibold text-board-navy mb-3">{sectionName}</h3>
          <div className="space-y-2">
            {Array.from(rows.entries()).map(([rowName, rowSeats]) => (
              <div key={rowName} className="flex items-center gap-1">
                <span className="w-8 text-xs text-board-navy/50 font-medium">{rowName}</span>
                <div className="flex gap-1 flex-wrap">
                  {rowSeats.map((seat) => (
                    <motion.button
                      key={seat.id}
                      whileTap={{ scale: 0.9 }}
                      onClick={() => toggleSeat(seat.id, seat.status)}
                      className={`w-8 h-8 rounded text-xs font-medium flex items-center justify-center transition-all duration-150 ${getSeatColor(seat)}`}
                      title={`${sectionName} - Fila ${seat.row} - Assento ${seat.number} (${seat.status})`}
                    >
                      {seat.number}
                    </motion.button>
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
              {currency} {totalPrice.toFixed(2)}
            </span>
          </div>
          <button
            onClick={() => onReserve(Array.from(selectedIds))}
            disabled={isReserving}
            className="btn-primary w-full disabled:opacity-50"
          >
            {isReserving ? 'Reservando...' : 'Reservar Assentos'}
          </button>
        </motion.div>
      )}
    </div>
  );
}
