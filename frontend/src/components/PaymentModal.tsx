import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface PaymentModalProps {
  reservationId: string;
  clientSecret: string;
  amount: number;
  expiresAt: string;
  onSuccess: () => void;
  onCancel: () => void;
}

type PaymentState = 'paying' | 'success' | 'expired' | 'error';

function formatTime(totalSeconds: number): string {
  if (totalSeconds <= 0) return '00:00';
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export default function PaymentModal({
  reservationId,
  clientSecret,
  amount,
  expiresAt,
  onSuccess,
  onCancel,
}: PaymentModalProps) {
  const isSimulated = clientSecret.startsWith('simulated_');
  const [state, setState] = useState<PaymentState>(isSimulated ? 'success' : 'paying');
  const [secondsLeft, setSecondsLeft] = useState<number>(() => {
    const diff = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000);
    return Math.max(diff, 0);
  });

  // Countdown timer
  useEffect(() => {
    if (state === 'success' || state === 'expired') return;

    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setState('expired');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [state]);

  // Auto-redirect on success after 3 seconds
  useEffect(() => {
    if (state !== 'success') return;

    const timeout = setTimeout(() => {
      onSuccess();
    }, 3000);

    return () => clearTimeout(timeout);
  }, [state, onSuccess]);

  const handleConfirmPayment = useCallback(() => {
    setState('success');
  }, []);

  const handleCancel = useCallback(() => {
    onCancel();
  }, [onCancel]);

  const timerIsLow = secondsLeft < 120;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <motion.div
          className="relative w-full max-w-md mx-4 rounded-2xl border-2 border-board-gold bg-board-navy shadow-2xl overflow-hidden"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.8, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        >
          {/* Header */}
          <div className="bg-board-navy border-b border-board-gold/30 px-6 py-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-board-gold">
                {state === 'success'
                  ? 'Pagamento Confirmado!'
                  : state === 'expired'
                    ? 'Reserva Expirada'
                    : 'Finalizar Pagamento'}
              </h2>
              {state === 'paying' && (
                <span
                  className={`font-mono text-sm font-bold px-3 py-1 rounded-full ${
                    timerIsLow
                      ? 'bg-board-crimson/20 text-board-crimson animate-pulse'
                      : 'bg-board-gold/20 text-board-gold'
                  }`}
                >
                  {formatTime(secondsLeft)}
                </span>
              )}
            </div>
          </div>

          {/* Body */}
          <div className="px-6 py-6">
            {/* Paying State */}
            {state === 'paying' && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-5"
              >
                {/* Amount display */}
                <div className="text-center">
                  <p className="text-sm text-gray-400">Valor total</p>
                  <p className="text-3xl font-bold text-white">
                    R$ {(amount / 100).toFixed(2).replace('.', ',')}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    Reserva: {reservationId.slice(0, 8)}...
                  </p>
                </div>

                {/* Simulated Card Form */}
                <div className="space-y-3 bg-white/5 rounded-xl p-4 border border-white/10">
                  <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold">
                    Dados do Cartão
                  </p>

                  {/* Card Number */}
                  <div className="space-y-1">
                    <label className="text-xs text-gray-400">Número do cartão</label>
                    <div className="bg-white/10 rounded-lg px-4 py-3 text-white font-mono text-sm border border-white/20">
                      4242 4242 4242 4242
                    </div>
                  </div>

                  {/* Expiry and CVC */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs text-gray-400">Validade</label>
                      <div className="bg-white/10 rounded-lg px-4 py-3 text-white font-mono text-sm border border-white/20">
                        12/28
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-gray-400">CVC</label>
                      <div className="bg-white/10 rounded-lg px-4 py-3 text-white font-mono text-sm border border-white/20">
                        123
                      </div>
                    </div>
                  </div>

                  <p className="text-xs text-gray-500 italic">
                    Cartão de teste pré-preenchido (modo simulado)
                  </p>
                </div>

                {/* Action Buttons */}
                <div className="flex gap-3">
                  <button
                    onClick={handleCancel}
                    className="flex-1 px-4 py-3 rounded-xl border border-white/20 text-gray-300 font-semibold hover:bg-white/5 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={handleConfirmPayment}
                    className="flex-1 px-4 py-3 rounded-xl bg-board-emerald text-white font-bold hover:bg-board-emerald/80 transition-colors shadow-lg shadow-board-emerald/20"
                  >
                    Confirmar Pagamento
                  </button>
                </div>
              </motion.div>
            )}

            {/* Success State */}
            {state === 'success' && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                className="text-center space-y-5 py-4"
              >
                {/* Checkmark Animation */}
                <motion.div
                  className="mx-auto w-20 h-20 rounded-full bg-board-emerald/20 flex items-center justify-center"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', damping: 12, stiffness: 200, delay: 0.2 }}
                >
                  <motion.svg
                    className="w-10 h-10 text-board-emerald"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={3}
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.5, delay: 0.4 }}
                  >
                    <motion.path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: 0.5, delay: 0.4 }}
                    />
                  </motion.svg>
                </motion.div>

                <div>
                  <h3 className="text-2xl font-bold text-board-emerald">
                    Ingresso garantido!
                  </h3>
                  <p className="text-gray-400 mt-2 text-sm">
                    Seu pagamento foi confirmado com sucesso.
                  </p>
                </div>

                <button
                  onClick={onSuccess}
                  className="px-6 py-3 rounded-xl bg-board-gold text-board-navy font-bold hover:bg-board-gold/80 transition-colors"
                >
                  Ver Meus Ingressos
                </button>

                <p className="text-xs text-gray-500">
                  Redirecionando automaticamente em alguns segundos...
                </p>
              </motion.div>
            )}

            {/* Expired State */}
            {state === 'expired' && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-center space-y-5 py-4"
              >
                <div className="mx-auto w-20 h-20 rounded-full bg-board-crimson/20 flex items-center justify-center">
                  <svg
                    className="w-10 h-10 text-board-crimson"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>

                <div>
                  <h3 className="text-2xl font-bold text-board-crimson">
                    Reserva expirada
                  </h3>
                  <p className="text-gray-400 mt-2 text-sm">
                    O tempo para pagamento se esgotou. Sua reserva foi cancelada.
                  </p>
                </div>

                <button
                  onClick={handleCancel}
                  className="px-6 py-3 rounded-xl border border-white/20 text-gray-300 font-semibold hover:bg-white/5 transition-colors"
                >
                  Fechar
                </button>
              </motion.div>
            )}

            {/* Error State */}
            {state === 'error' && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="text-center space-y-5 py-4"
              >
                <div className="mx-auto w-20 h-20 rounded-full bg-board-crimson/20 flex items-center justify-center">
                  <svg
                    className="w-10 h-10 text-board-crimson"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
                    />
                  </svg>
                </div>

                <div>
                  <h3 className="text-2xl font-bold text-board-crimson">
                    Erro no pagamento
                  </h3>
                  <p className="text-gray-400 mt-2 text-sm">
                    Ocorreu um erro ao processar o pagamento. Tente novamente.
                  </p>
                </div>

                <div className="flex gap-3 justify-center">
                  <button
                    onClick={handleCancel}
                    className="px-6 py-3 rounded-xl border border-white/20 text-gray-300 font-semibold hover:bg-white/5 transition-colors"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => setState('paying')}
                    className="px-6 py-3 rounded-xl bg-board-gold text-board-navy font-bold hover:bg-board-gold/80 transition-colors"
                  >
                    Tentar Novamente
                  </button>
                </div>
              </motion.div>
            )}
          </div>

          {/* Footer decoration */}
          <div className="h-1 bg-gradient-to-r from-board-crimson via-board-gold to-board-emerald" />
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
