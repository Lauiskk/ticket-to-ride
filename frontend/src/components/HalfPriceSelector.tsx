import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { HalfPriceClaim, HalfPriceCategory } from '../types';

/**
 * Half-price declaration at checkout (SPEC_CP12 RF-9).
 *
 * Modelled on how ingresso.com and Sympla actually do it: you do not upload a
 * student card at 2am, you *declare* the benefit, give the document number, and
 * accept that the gate will ask to see it. That keeps the flow one screen long
 * and puts the verification where it belongs — at the door, with a human.
 *
 * The price is not computed here beyond a preview: the server recalculates it.
 */

const CATEGORIES: Array<{ value: HalfPriceCategory; label: string; document: string }> = [
  { value: 'student', label: 'Estudante', document: 'Carteira estudantil (nº)' },
  { value: 'senior', label: '60+ anos', document: 'RG ou CPF' },
  { value: 'pcd', label: 'PCD', document: 'Documento comprobatório (nº)' },
];

interface SeatOption {
  id: string;
  label: string;
}

interface Props {
  seats: SeatOption[];
  price: number;
  currency: string;
  onChange: (claims: HalfPriceClaim[], valid: boolean) => void;
}

interface Draft {
  enabled: boolean;
  category: HalfPriceCategory;
  document: string;
}

export function HalfPriceSelector({ seats, price, currency, onChange }: Props) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [accepted, setAccepted] = useState(false);

  const money = (v: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(v);

  const active = seats.filter((s) => drafts[s.id]?.enabled);
  const hasClaims = active.length > 0;

  // Every claim needs a document, and the declaration must be accepted
  const complete =
    !hasClaims ||
    (accepted && active.every((s) => (drafts[s.id]?.document ?? '').trim().length >= 5));

  useEffect(() => {
    const claims: HalfPriceClaim[] = active.map((s) => ({
      seatId: s.id,
      category: drafts[s.id].category,
      document: drafts[s.id].document.trim(),
    }));
    onChange(claims, complete);
    // `active` is derived from drafts; depending on drafts keeps this honest
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drafts, accepted, seats.length]);

  const toggle = (seatId: string) =>
    setDrafts((prev) => {
      const current = prev[seatId];
      return {
        ...prev,
        [seatId]: {
          enabled: !current?.enabled,
          category: current?.category ?? 'student',
          document: current?.document ?? '',
        },
      };
    });

  const update = (seatId: string, patch: Partial<Draft>) =>
    setDrafts((prev) => ({ ...prev, [seatId]: { ...prev[seatId], ...patch } }));

  if (seats.length === 0) return null;

  return (
    <div className="mt-4 pt-4 border-t border-board-gold/30">
      <p className="text-sm font-medium text-board-navy mb-1">Meia-entrada</p>
      <p className="text-xs text-board-navy/50 mb-3">
        Marque quem tem direito. O documento será conferido na entrada — sem ele, o ingresso não
        dá acesso.
      </p>

      <div className="space-y-2">
        {seats.map((seat) => {
          const draft = drafts[seat.id];
          const category = CATEGORIES.find((c) => c.value === (draft?.category ?? 'student'))!;

          return (
            <div
              key={seat.id}
              className={`rounded-lg border transition-colors ${
                draft?.enabled
                  ? 'border-board-crimson/40 bg-board-crimson/5'
                  : 'border-board-parchment-dark bg-white/50'
              }`}
            >
              <label className="flex items-center gap-3 px-3 py-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!draft?.enabled}
                  onChange={() => toggle(seat.id)}
                  className="w-4 h-4 accent-board-crimson"
                />
                <span className="flex-1 text-sm text-board-navy">{seat.label}</span>
                <span
                  className={`text-sm font-semibold ${
                    draft?.enabled ? 'text-board-crimson' : 'text-board-navy/60'
                  }`}
                >
                  {money(draft?.enabled ? price / 2 : price)}
                </span>
              </label>

              <AnimatePresence>
                {draft?.enabled && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="px-3 pb-3 pt-1 space-y-2">
                      <div className="flex gap-1.5">
                        {CATEGORIES.map((c) => (
                          <button
                            key={c.value}
                            onClick={() => update(seat.id, { category: c.value })}
                            className={`flex-1 px-2 py-1.5 rounded text-xs font-medium border transition-colors ${
                              draft.category === c.value
                                ? 'bg-board-crimson text-white border-board-crimson'
                                : 'bg-white text-board-navy/70 border-board-parchment-dark hover:border-board-crimson/40'
                            }`}
                          >
                            {c.label}
                          </button>
                        ))}
                      </div>

                      <input
                        value={draft.document}
                        onChange={(e) => update(seat.id, { document: e.target.value })}
                        placeholder={category.document}
                        className="w-full px-3 py-2 rounded border border-board-parchment-dark bg-white text-sm focus:outline-none focus:ring-2 focus:ring-board-gold/40"
                      />
                      {draft.document.trim().length > 0 && draft.document.trim().length < 5 && (
                        <p className="text-board-crimson text-xs">
                          Informe o número completo do documento.
                        </p>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>

      {hasClaims && (
        <label className="flex items-start gap-2.5 mt-3 cursor-pointer">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-0.5 w-4 h-4 accent-board-crimson"
          />
          <span className="text-xs text-board-navy/70 leading-snug">
            Declaro que as informações são verdadeiras e que apresentarei o documento original na
            entrada. Sem comprovação, a portaria pode recusar o acesso.
          </span>
        </label>
      )}
    </div>
  );
}
