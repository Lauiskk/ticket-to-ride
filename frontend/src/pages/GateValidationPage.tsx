import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../lib/api';
import type { ValidationResult } from '../types';

export function GateValidationPage() {
  const [eventId, setEventId] = useState('');
  const [manualCode, setManualCode] = useState('');
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [validating, setValidating] = useState(false);
  const [scannerActive, setScannerActive] = useState(false);
  const scannerRef = useRef<any>(null);

  // Auto-reset result after 3 seconds
  useEffect(() => {
    if (result) {
      const timer = setTimeout(() => setResult(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [result]);

  // Initialize QR scanner
  useEffect(() => {
    if (!eventId || !scannerActive) return;

    let html5QrCode: any = null;

    const initScanner = async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        html5QrCode = new Html5Qrcode('qr-reader');
        scannerRef.current = html5QrCode;

        await html5QrCode.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decodedText: string) => {
            handleValidation(decodedText);
          },
          () => {} // Ignore errors during scanning
        );
      } catch (err) {
        console.warn('Camera not available:', err);
        setScannerActive(false);
      }
    };

    initScanner();

    return () => {
      if (html5QrCode?.isScanning) {
        html5QrCode.stop().catch(() => {});
      }
    };
  }, [eventId, scannerActive]);

  const handleValidation = async (qrPayload: string) => {
    if (validating || !eventId) return;
    setValidating(true);

    try {
      const res = await api.post<ValidationResult>('/gate/validate', { qrPayload, eventId });
      setResult(res.data);
    } catch (err: any) {
      const code = err.code || 'UNKNOWN';
      const message = err.message || 'Erro desconhecido';
      setResult({
        valid: false,
        error: { code, message },
      });
    } finally {
      setValidating(false);
    }
  };

  const handleManualSubmit = () => {
    if (manualCode.trim()) {
      handleValidation(manualCode.trim());
      setManualCode('');
    }
  };

  // Full-screen result overlay
  const getResultDisplay = () => {
    if (!result) return null;

    if (result.valid) {
      return {
        bg: 'bg-board-emerald',
        icon: '✓',
        title: 'ENTRADA LIBERADA',
        details: `${result.eventTitle || ''} • Assento: ${result.seatIdentifier || ''}`,
      };
    }

    const code = result.error?.code || '';
    switch (code) {
      case 'TICKET_ALREADY_USED':
        return { bg: 'bg-board-gold', icon: '⚠', title: 'JÁ UTILIZADO', details: `Validado em: ${result.error?.firstValidatedAt ? new Date(result.error.firstValidatedAt).toLocaleString('pt-BR') : ''}` };
      case 'INVALID_TICKET':
        return { bg: 'bg-board-crimson', icon: '✗', title: 'INGRESSO INVÁLIDO', details: result.error?.message || '' };
      case 'EVENT_NOT_ACTIVE':
        return { bg: 'bg-yellow-600', icon: '⏸', title: 'EVENTO NÃO ATIVO', details: result.error?.message || '' };
      default:
        return { bg: 'bg-board-crimson', icon: '✗', title: 'ERRO', details: result.error?.message || 'Ingresso inválido' };
    }
  };

  const display = getResultDisplay();

  return (
    <div className="min-h-screen bg-board-navy py-12 px-4 relative">
      {/* Result overlay */}
      <AnimatePresence>
        {display && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className={`fixed inset-0 z-50 flex flex-col items-center justify-center ${display.bg}`}
          >
            <span className="text-8xl text-white mb-4">{display.icon}</span>
            <h2 className="font-display text-4xl font-bold text-white mb-2">{display.title}</h2>
            <p className="text-white/80 text-lg">{display.details}</p>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="max-w-md mx-auto">
        <motion.h1 initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="font-display text-3xl font-bold text-board-parchment text-center mb-8">
          Validação de Ingresso
        </motion.h1>

        {/* Event selector */}
        {!eventId ? (
          <div className="bg-board-navy-light rounded-card p-6 border border-board-gold/20 mb-6">
            <h2 className="text-board-parchment font-medium mb-3">Selecione o evento:</h2>
            <input
              type="text"
              value={eventId}
              onChange={(e) => setEventId(e.target.value)}
              placeholder="Cole o ID do evento aqui..."
              className="w-full px-4 py-3 rounded-lg bg-board-navy border border-board-gold/30 text-board-parchment placeholder-board-parchment/30 focus:outline-none focus:ring-2 focus:ring-board-gold/50 font-ticket text-sm mb-3"
            />
            <button onClick={() => { if (eventId.trim()) setScannerActive(true); }} className="btn-gold w-full">Iniciar Validação</button>
          </div>
        ) : (
          <>
            {/* Camera scanner */}
            <div className="bg-board-navy-light rounded-card p-4 mb-6 border border-board-gold/20">
              <div id="qr-reader" className="w-full rounded-lg overflow-hidden mb-3" style={{ minHeight: scannerActive ? 300 : 0 }} />
              {!scannerActive && (
                <button onClick={() => setScannerActive(true)} className="btn-gold w-full">
                  Ativar Câmera
                </button>
              )}
              {scannerActive && (
                <p className="text-board-parchment/60 text-sm text-center">Aponte para o QR Code</p>
              )}
            </div>

            {/* Manual input */}
            <div className="bg-board-navy-light rounded-card p-6 border border-board-gold/20">
              <h2 className="text-board-parchment font-medium mb-3">Ou digite o código:</h2>
              <input
                type="text"
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleManualSubmit()}
                placeholder="Cole o payload do QR aqui..."
                className="w-full px-4 py-3 rounded-lg bg-board-navy border border-board-gold/30 text-board-parchment placeholder-board-parchment/30 focus:outline-none focus:ring-2 focus:ring-board-gold/50 font-ticket text-sm"
              />
              <button onClick={handleManualSubmit} disabled={validating} className="btn-gold w-full mt-3">
                {validating ? 'Validando...' : 'Validar'}
              </button>
            </div>

            {/* Change event */}
            <button onClick={() => { setEventId(''); setScannerActive(false); }} className="w-full mt-4 text-board-parchment/40 text-sm hover:text-board-parchment/70">
              Trocar evento
            </button>
          </>
        )}
      </div>
    </div>
  );
}
