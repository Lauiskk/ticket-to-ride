import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { api } from '../lib/api';

export function PaymentPage() {
  const { reservationId } = useParams<{ reservationId: string }>();
  const navigate = useNavigate();
  const [timeLeft, setTimeLeft] = useState(600); // 10 minutes in seconds
  const [paying, setPaying] = useState(false);
  const [result, setResult] = useState<'success' | 'failure' | null>(null);

  // Countdown timer
  useEffect(() => {
    if (result) return;
    const interval = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          clearInterval(interval);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [result]);

  // Redirect on expiry
  useEffect(() => {
    if (timeLeft === 0 && !result) {
      navigate(-1);
    }
  }, [timeLeft, result, navigate]);

  // Auto-navigate on success
  useEffect(() => {
    if (result === 'success') {
      const timer = setTimeout(() => navigate('/my-tickets'), 3000);
      return () => clearTimeout(timer);
    }
  }, [result, navigate]);

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const handlePay = async () => {
    setPaying(true);
    try {
      await api.post(`/payments/${reservationId}`);
      // Simulate 2s processing
      await new Promise((r) => setTimeout(r, 2000));
      setResult('success');
    } catch {
      setResult('failure');
    } finally {
      setPaying(false);
    }
  };

  const handleSimulateFailure = () => {
    setResult('failure');
  };

  if (result === 'success') {
    return (
      <div className="min-h-screen bg-board-cream flex items-center justify-center">
        <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-center">
          <div className="w-20 h-20 bg-board-emerald/20 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-10 h-10 text-board-emerald" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="font-display text-2xl font-bold text-board-navy mb-2">Pagamento Confirmado!</h2>
          <p className="text-board-navy/60">Redirecionando para seus ingressos...</p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-board-cream py-12 px-4">
      <div className="max-w-md mx-auto">
        {/* Timer */}
        <div className={`text-center mb-8 font-ticket text-2xl font-bold ${timeLeft <= 120 ? 'text-board-crimson' : 'text-board-navy'}`}>
          Reserva expira em: {formatTime(timeLeft)}
        </div>

        <div className="card-game p-8">
          <h1 className="font-display text-2xl font-bold text-board-navy text-center mb-6">Pagamento</h1>

          {result === 'failure' && (
            <div className="bg-board-crimson/10 border border-board-crimson/30 text-board-crimson rounded-lg p-3 mb-4 text-sm text-center">
              Pagamento recusado. Tente novamente.
            </div>
          )}

          {/* Simulated card form */}
          <div className="space-y-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-board-navy/70 mb-1">Número do Cartão</label>
              <input
                type="text"
                value="4242 4242 4242 4242"
                readOnly
                className="w-full px-4 py-3 rounded-lg border border-board-parchment-dark bg-board-parchment/50 text-board-navy/60 font-ticket"
              />
            </div>
            <div className="flex gap-4">
              <div className="flex-1">
                <label className="block text-sm font-medium text-board-navy/70 mb-1">Validade</label>
                <input type="text" value="12/28" readOnly className="w-full px-4 py-3 rounded-lg border border-board-parchment-dark bg-board-parchment/50 text-board-navy/60 font-ticket" />
              </div>
              <div className="w-24">
                <label className="block text-sm font-medium text-board-navy/70 mb-1">CVC</label>
                <input type="text" value="123" readOnly className="w-full px-4 py-3 rounded-lg border border-board-parchment-dark bg-board-parchment/50 text-board-navy/60 font-ticket" />
              </div>
            </div>
          </div>

          <p className="text-xs text-board-navy/40 text-center mb-4">Modo teste — nenhuma cobrança real será feita</p>

          <button onClick={handlePay} disabled={paying || timeLeft === 0} className="btn-primary w-full mb-3 disabled:opacity-50">
            {paying ? 'Processando...' : 'Confirmar Pagamento'}
          </button>

          <button onClick={handleSimulateFailure} disabled={paying} className="w-full text-sm text-board-navy/50 hover:text-board-crimson transition-colors">
            Simular recusa
          </button>
        </div>
      </div>
    </div>
  );
}
