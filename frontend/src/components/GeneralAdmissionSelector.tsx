import { useState } from 'react';
import { motion } from 'framer-motion';

interface GeneralAdmissionSelectorProps {
  availableCount: number;
  price: number;
  currency: string;
  seatIds: string[]; // Available seat IDs to select from
  onReserve: (seatIds: string[]) => void;
  isReserving: boolean;
}

export function GeneralAdmissionSelector({
  availableCount,
  price,
  currency,
  seatIds,
  onReserve,
  isReserving,
}: GeneralAdmissionSelectorProps) {
  const [quantity, setQuantity] = useState(1);

  const maxQuantity = Math.min(availableCount, 10); // Max 10 per transaction
  const totalPrice = quantity * price;

  const increment = () => setQuantity((q) => Math.min(q + 1, maxQuantity));
  const decrement = () => setQuantity((q) => Math.max(q - 1, 1));

  const handleReserve = () => {
    // Select the first N available seat IDs
    const selected = seatIds.slice(0, quantity);
    onReserve(selected);
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
          {currency} {totalPrice.toFixed(2)}
        </span>
      </div>

      {/* Reserve button */}
      <motion.button
        whileTap={{ scale: 0.97 }}
        onClick={handleReserve}
        disabled={isReserving || availableCount === 0}
        className="btn-primary w-full disabled:opacity-50"
      >
        {isReserving ? 'Reservando...' : `Reservar ${quantity} ingresso${quantity > 1 ? 's' : ''}`}
      </motion.button>
    </div>
  );
}
