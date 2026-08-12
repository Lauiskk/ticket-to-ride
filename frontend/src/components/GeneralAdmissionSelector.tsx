import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { HalfPriceSelector } from './HalfPriceSelector';
import { formatMoney } from '../lib/eventStatus';
import type { HalfPriceClaim } from '../types';

interface GeneralAdmissionSelectorProps {
  availableCount: number;
  price: number;
  seatIds: string[]; // Available seat IDs to select from
  /** Whether this event offers half-price tickets (SPEC_CP12). */
  halfPriceEnabled?: boolean;
  onReserve: (seatIds: string[], halfPriceClaims: HalfPriceClaim[]) => void;
  isReserving: boolean;
}

export function GeneralAdmissionSelector({
  availableCount,
  price,
  seatIds,
  halfPriceEnabled = false,
  onReserve,
  isReserving,
}: GeneralAdmissionSelectorProps) {
  const [quantity, setQuantity] = useState(1);
  const [halfPriceClaims, setHalfPriceClaims] = useState<HalfPriceClaim[]>([]);
  const [halfPriceValid, setHalfPriceValid] = useState(true);

  const maxQuantity = Math.min(availableCount, 10); // Max 10 per transaction

  // In general admission the "seat" is just a slot — we take the first N, and
  // the half-price picker labels them by position so the buyer can tell which
  // of their own tickets carries the benefit.
  const chosen = useMemo(
    () =>
      seatIds.slice(0, quantity).map((id, i) => ({ id, label: `Ingresso ${i + 1}` })),
    [seatIds, quantity],
  );

  const halfCount = halfPriceClaims.length;
  const totalPrice = (quantity - halfCount) * price + halfCount * (price / 2);

  const increment = () => setQuantity((q) => Math.min(q + 1, maxQuantity));
  const decrement = () => setQuantity((q) => Math.max(q - 1, 1));

  const handleReserve = () => {
    onReserve(
      chosen.map((c) => c.id),
      halfPriceClaims,
    );
  };

  return (
    <div className="p-6 bg-board-parchment rounded-lg border border-board-gold/30">
      <h3 className="font-display text-xl font-semibold text-board-navy mb-4">Pista Geral</h3>

      <p className="text-board-navy/60 text-sm mb-6">
        {availableCount} ingresso{availableCount !== 1 ? 's' : ''} disponíve{availableCount !== 1 ? 'is' : 'l'}
      </p>

      {/* Quantity selector */}
      <div className="flex items-center justify-center gap-4 mb-6">
        <button
          onClick={decrement}
          disabled={quantity <= 1}
          className="w-12 h-12 rounded-full bg-board-navy text-board-parchment font-bold text-xl
                     disabled:opacity-30 hover:bg-board-navy-light transition-colors"
        >
          −
        </button>
        <span className="font-display text-4xl font-bold text-board-navy w-16 text-center">
          {quantity}
        </span>
        <button
          onClick={increment}
          disabled={quantity >= maxQuantity}
          className="w-12 h-12 rounded-full bg-board-navy text-board-parchment font-bold text-xl
                     disabled:opacity-30 hover:bg-board-navy-light transition-colors"
        >
          +
        </button>
      </div>

      {/* Price */}
      <div className="text-center mb-6">
        <span className="text-board-navy/60 text-sm">Total: </span>
        <span className="font-display text-2xl font-bold text-board-crimson">
          {formatMoney(totalPrice)}
        </span>
      </div>

      {halfPriceEnabled && (
        <HalfPriceSelector
          seats={chosen}
          price={price}
          currency="BRL"
          onChange={(claims, valid) => {
            setHalfPriceClaims(claims);
            setHalfPriceValid(valid);
          }}
        />
      )}

      {/* Reserve button */}
      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={handleReserve}
        disabled={isReserving || availableCount === 0 || !halfPriceValid}
        className="btn-primary w-full mt-4 disabled:opacity-50"
      >
        {isReserving
          ? 'Reservando...'
          : !halfPriceValid
            ? 'Complete os dados da meia-entrada'
            : `Reservar ${quantity} ingresso${quantity > 1 ? 's' : ''}`}
      </motion.button>
    </div>
  );
}
