import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';
import { api } from '../lib/api';

/**
 * Checkout modal — SPEC_CP10.
 *
 * Two modes, decided by the backend, never by the browser:
 * - real:      backend returned a Stripe clientSecret → Stripe Elements collects
 *              the card and Stripe confirms it. The webhook (or the reconciliation
 *              poll on /payments/:id/status) is what actually marks it paid.
 * - simulated: backend has no Stripe key → single "confirm" call, no network to Stripe.
 *
 * The modal is deliberately a trap: no backdrop click, no Escape. The reservation
 * holds seats for other people, so leaving is an explicit decision — pay or cancel.
 */

const PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined;
const stripePromise = PUBLISHABLE_KEY ? loadStripe(PUBLISHABLE_KEY) : null;

/** How long we wait for the webhook before telling the user to check the tickets page. */
const STATUS_POLL_INTERVAL_MS = 1500;
const STATUS_POLL_TIMEOUT_MS = 30000;

interface PaymentModalProps {
  reservationId: string;
  clientSecret: string;
  /** Total in the event currency unit (reais), NOT cents. */
  amount: number;
  currency?: string;
  expiresAt: string;
  onSuccess: () => void;
  onCancel: () => void;
}

type PaymentState = 'paying' | 'processing' | 'settling' | 'success' | 'expired' | 'declined';

function formatMoney(amount: number, currency = 'BRL'): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(amount);
}

function formatTime(totalSeconds: number): string {
  if (totalSeconds <= 0) return '00:00';
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// ─── Shell ────────────────────────────────────────────────────────────────────

export function PaymentModal(props: PaymentModalProps) {
  const isSimulated = props.clientSecret.startsWith('simulated_') || !stripePromise;

  // Lock the page behind the modal — the reservation is holding seats.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const blockEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') e.preventDefault();
    };
    window.addEventListener('keydown', blockEscape);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', blockEscape);
    };
  }, []);

  const stripeOptions = useMemo(
    () => ({
      clientSecret: props.clientSecret,
      appearance: {
        theme: 'night' as const,
        variables: {
          colorPrimary: '#c9a227',
          colorBackground: '#16213e',
          colorText: '#f4ecd8',
          colorDanger: '#c1272d',
          fontFamily: 'system-ui, sans-serif',
          borderRadius: '10px',
        },
      },
    }),
    [props.clientSecret],
  );

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        role="dialog"
        aria-modal="true"
        aria-label="Finalizar pagamento"
      >
        <motion.div
          className="relative w-full max-w-md rounded-2xl border-2 border-board-gold bg-board-navy shadow-2xl overflow-hidden max-h-[92vh] overflow-y-auto"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        >
          {isSimulated ? (
            <SimulatedCheckout {...props} />
          ) : (
            <Elements stripe={stripePromise} options={stripeOptions}>
              <StripeCheckout {...props} />
            </Elements>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Shared chrome ────────────────────────────────────────────────────────────

function Header({
  state,
  secondsLeft,
}: {
  state: PaymentState;
  secondsLeft: number;
}) {
  const title =
    state === 'success'
      ? 'Pagamento confirmado'
      : state === 'expired'
        ? 'Reserva expirada'
        : state === 'declined'
          ? 'Pagamento recusado'
          : state === 'settling'
            ? 'Confirmando...'
            : state === 'processing'
              ? 'Processando...'
              : 'Finalizar pagamento';

  const timerIsLow = secondsLeft < 120;

  return (
    <div className="bg-board-navy border-b border-board-gold/30 px-6 py-4 sticky top-0 z-10">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-bold text-board-gold">{title}</h2>
        {state === 'paying' && (
          <span
            className={`font-mono text-sm font-bold px-3 py-1 rounded-full whitespace-nowrap ${
              timerIsLow
                ? 'bg-board-crimson/20 text-board-crimson animate-pulse'
                : 'bg-board-gold/20 text-board-gold'
            }`}
            aria-label="Tempo restante da reserva"
          >
            {formatTime(secondsLeft)}
          </span>
        )}
      </div>
    </div>
  );
}

function Footer() {
  return <div className="h-1 bg-gradient-to-r from-board-crimson via-board-gold to-board-emerald" />;
}

function AmountBlock({
  amount,
  currency,
  reservationId,
}: {
  amount: number;
  currency?: string;
  reservationId: string;
}) {
  return (
    <div className="text-center">
      <p className="text-sm text-gray-400">Valor total</p>
      <p className="text-3xl font-bold text-white">{formatMoney(amount, currency)}</p>
      <p className="text-xs text-gray-500 mt-1 font-mono">
        Reserva {reservationId.slice(0, 8)}
      </p>
    </div>
  );
}

function SuccessPanel({ onSuccess, ticketCount }: { onSuccess: () => void; ticketCount: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="text-center space-y-5 py-4"
    >
      <motion.div
        className="mx-auto w-20 h-20 rounded-full bg-board-emerald/20 flex items-center justify-center"
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', damping: 12, stiffness: 200, delay: 0.1 }}
      >
        <svg
          className="w-10 h-10 text-board-emerald"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={3}
        >
          <motion.path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5 13l4 4L19 7"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.5, delay: 0.3 }}
          />
        </svg>
      </motion.div>

      <div>
        <h3 className="text-2xl font-bold text-board-emerald">Ingresso garantido!</h3>
        <p className="text-gray-400 mt-2 text-sm">
          {ticketCount > 0
            ? `${ticketCount} ingresso${ticketCount > 1 ? 's' : ''} com QR Code ${ticketCount > 1 ? 'gerados' : 'gerado'}.`
            : 'Pagamento aprovado. Seu ingresso está sendo emitido.'}
        </p>
      </div>

      <button
        onClick={onSuccess}
        className="px-6 py-3 rounded-xl bg-board-gold text-board-navy font-bold hover:bg-board-gold/80 transition-colors"
      >
        Ver meus ingressos
      </button>
    </motion.div>
  );
}

function ExpiredPanel({ onCancel }: { onCancel: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="text-center space-y-5 py-4"
    >
      <div className="mx-auto w-20 h-20 rounded-full bg-board-crimson/20 flex items-center justify-center">
        <svg className="w-10 h-10 text-board-crimson" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </div>
      <div>
        <h3 className="text-2xl font-bold text-board-crimson">Tempo esgotado</h3>
        <p className="text-gray-400 mt-2 text-sm">
          Os assentos voltaram para o mapa e estão disponíveis para outras pessoas.
        </p>
      </div>
      <button
        onClick={onCancel}
        className="px-6 py-3 rounded-xl border border-white/20 text-gray-300 font-semibold hover:bg-white/5 transition-colors"
      >
        Escolher de novo
      </button>
    </motion.div>
  );
}

// ─── Real Stripe checkout ─────────────────────────────────────────────────────

function StripeCheckout({
  reservationId,
  amount,
  currency,
  expiresAt,
  onSuccess,
  onCancel,
}: PaymentModalProps) {
  const stripe = useStripe();
  const elements = useElements();

  const [state, setState] = useState<PaymentState>('paying');
  const [errorMessage, setErrorMessage] = useState('');
  const [ticketCount, setTicketCount] = useState(0);
  const [slowWebhook, setSlowWebhook] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000), 0),
  );

  const cancelled = useRef(false);
  useEffect(() => () => { cancelled.current = true; }, []);

  // Reservation countdown
  useEffect(() => {
    if (state !== 'paying') return;
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

  /**
   * Stripe approved the card, but "paid" only becomes true once our backend
   * processes the webhook. Poll until it does — /status also reconciles
   * directly with Stripe, so this works even without `stripe listen`.
   */
  const waitForSettlement = useCallback(async () => {
    const deadline = Date.now() + STATUS_POLL_TIMEOUT_MS;

    while (Date.now() < deadline && !cancelled.current) {
      try {
        const res = await api.get<{ status: string; ticketCount: number }>(
          `/payments/${reservationId}/status`,
        );
        if (res.data.status === 'succeeded') {
          setTicketCount(res.data.ticketCount);
          setState('success');
          return;
        }
        if (res.data.status === 'failed') {
          setErrorMessage('O pagamento foi recusado pela operadora.');
          setState('declined');
          return;
        }
      } catch {
        // transient — keep polling until the deadline
      }
      if (Date.now() > deadline - STATUS_POLL_TIMEOUT_MS + 6000) setSlowWebhook(true);
      await new Promise((r) => setTimeout(r, STATUS_POLL_INTERVAL_MS));
    }

    if (cancelled.current) return;
    // Card was approved; only the confirmation is late. Don't claim failure.
    setState('success');
  }, [reservationId]);

  const handleSubmit = useCallback(async () => {
    if (!stripe || !elements) return;

    setState('processing');
    setErrorMessage('');

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: 'if_required',
    });

    if (error) {
      setErrorMessage(
        error.message || 'Não foi possível processar o pagamento com este cartão.',
      );
      setState('declined');
      return;
    }

    if (paymentIntent?.status === 'succeeded' || paymentIntent?.status === 'processing') {
      setState('settling');
      await waitForSettlement();
      return;
    }

    setErrorMessage('O pagamento não foi concluído. Tente outro cartão.');
    setState('declined');
  }, [stripe, elements, waitForSettlement]);

  return (
    <>
      <Header state={state} secondsLeft={secondsLeft} />

      <div className="px-6 py-6">
        {(state === 'paying' || state === 'processing') && (
          <div className="space-y-5">
            <AmountBlock amount={amount} currency={currency} reservationId={reservationId} />

            <div className="bg-white/5 rounded-xl p-4 border border-white/10">
              <PaymentElement options={{ layout: 'tabs' }} />
            </div>

            <p className="text-xs text-gray-500 text-center">
              Ambiente de teste da Stripe — use{' '}
              <code className="text-board-gold">4242 4242 4242 4242</code>, validade futura e
              qualquer CVC.
            </p>

            <div className="flex gap-3">
              <button
                onClick={onCancel}
                disabled={state === 'processing'}
                className="flex-1 px-4 py-3 rounded-xl border border-white/20 text-gray-300 font-semibold hover:bg-white/5 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleSubmit}
                disabled={!stripe || state === 'processing'}
                className="flex-1 px-4 py-3 rounded-xl bg-board-emerald text-white font-bold hover:bg-board-emerald/80 transition-colors shadow-lg shadow-board-emerald/20 disabled:opacity-50"
              >
                {state === 'processing' ? 'Processando...' : `Pagar ${formatMoney(amount, currency)}`}
              </button>
            </div>
          </div>
        )}

        {state === 'settling' && (
          <div className="text-center space-y-4 py-8">
            <div className="mx-auto w-14 h-14 rounded-full border-4 border-board-gold/30 border-t-board-gold animate-spin" />
            <p className="text-board-parchment font-semibold">Confirmando com a operadora</p>
            <p className="text-gray-400 text-sm">
              {slowWebhook
                ? 'Está demorando mais que o normal. Não feche esta janela.'
                : 'Emitindo seu ingresso e assinando o QR Code...'}
            </p>
          </div>
        )}

        {state === 'success' && <SuccessPanel onSuccess={onSuccess} ticketCount={ticketCount} />}

        {state === 'expired' && <ExpiredPanel onCancel={onCancel} />}

        {state === 'declined' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center space-y-5 py-4"
          >
            <div className="mx-auto w-20 h-20 rounded-full bg-board-crimson/20 flex items-center justify-center">
              <svg className="w-10 h-10 text-board-crimson" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <div>
              <h3 className="text-2xl font-bold text-board-crimson">Pagamento recusado</h3>
              <p className="text-gray-400 mt-2 text-sm">{errorMessage}</p>
            </div>
            <div className="flex gap-3">
              <button
                onClick={onCancel}
                className="flex-1 px-4 py-3 rounded-xl border border-white/20 text-gray-300 font-semibold hover:bg-white/5 transition-colors"
              >
                Desistir
              </button>
              <button
                onClick={() => setState('paying')}
                className="flex-1 px-4 py-3 rounded-xl bg-board-gold text-board-navy font-bold hover:bg-board-gold/80 transition-colors"
              >
                Tentar outro cartão
              </button>
            </div>
          </motion.div>
        )}
      </div>

      <Footer />
    </>
  );
}

// ─── Simulated checkout (no Stripe key configured) ────────────────────────────

function SimulatedCheckout({
  reservationId,
  amount,
  currency,
  expiresAt,
  onSuccess,
  onCancel,
}: PaymentModalProps) {
  const [state, setState] = useState<PaymentState>('paying');
  const [ticketCount, setTicketCount] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(() =>
    Math.max(Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000), 0),
  );

  useEffect(() => {
    if (state !== 'paying') return;
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

  const handleConfirm = useCallback(async () => {
    setState('processing');
    try {
      const res = await api.post<{ success: boolean; ticketCount: number }>(
        `/payments/${reservationId}/confirm`,
      );
      setTicketCount(res.data?.ticketCount ?? 0);
      setState('success');
    } catch {
      setState('declined');
    }
  }, [reservationId]);

  return (
    <>
      <Header state={state} secondsLeft={secondsLeft} />

      <div className="px-6 py-6">
        {(state === 'paying' || state === 'processing') && (
          <div className="space-y-5">
            <AmountBlock amount={amount} currency={currency} reservationId={reservationId} />

            <div className="bg-board-gold/10 border border-board-gold/30 rounded-xl p-4">
              <p className="text-board-gold text-sm font-semibold">Modo simulado</p>
              <p className="text-gray-400 text-xs mt-1">
                Nenhuma chave Stripe configurada — a cobrança é simulada no servidor e nenhum
                dado de cartão é solicitado.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={onCancel}
                disabled={state === 'processing'}
                className="flex-1 px-4 py-3 rounded-xl border border-white/20 text-gray-300 font-semibold hover:bg-white/5 transition-colors disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleConfirm}
                disabled={state === 'processing'}
                className="flex-1 px-4 py-3 rounded-xl bg-board-emerald text-white font-bold hover:bg-board-emerald/80 transition-colors disabled:opacity-50"
              >
                {state === 'processing' ? 'Processando...' : 'Simular pagamento'}
              </button>
            </div>
          </div>
        )}

        {state === 'success' && <SuccessPanel onSuccess={onSuccess} ticketCount={ticketCount} />}
        {state === 'expired' && <ExpiredPanel onCancel={onCancel} />}

        {state === 'declined' && (
          <div className="text-center space-y-5 py-4">
            <h3 className="text-2xl font-bold text-board-crimson">Falha na simulação</h3>
            <p className="text-gray-400 text-sm">
              O servidor não conseguiu confirmar esta reserva.
            </p>
            <button
              onClick={onCancel}
              className="px-6 py-3 rounded-xl border border-white/20 text-gray-300 font-semibold hover:bg-white/5 transition-colors"
            >
              Fechar
            </button>
          </div>
        )}
      </div>

      <Footer />
    </>
  );
}
