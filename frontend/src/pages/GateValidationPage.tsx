import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { api } from '../lib/api';
import { useEvents } from '../hooks/useEvents';
import type { ValidationResult, Event } from '../types';

export function GateValidationPage() {
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [validating, setValidating] = useState(false);
  const [scannerActive, setScannerActive] = useState(false);
  const [loadingEvent, setLoadingEvent] = useState(false);
  const [eventError, setEventError] = useState('');

  const { data: eventsData, isLoading: loadingEvents } = useEvents({ pageSize: 50 });
  const events = eventsData?.data || [];

  useEffect(() => {
    if (result) {
      const timer = setTimeout(() => setResult(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [result]);

  useEffect(() => {
    if (!selectedEvent || !scannerActive) return;
    let html5QrCode: any = null;
    const initScanner = async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        html5QrCode = new Html5Qrcode('qr-reader');
        await html5QrCode.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decodedText: string) => { handleValidation(decodedText); },
          () => {}
        );
      } catch {
        setScannerActive(false);
      }
    };
    initScanner();
    return () => { if (html5QrCode?.isScanning) html5QrCode.stop().catch(() => {}); };
  }, [selectedEvent, scannerActive]);

  const handleSelectEvent = async (event: Event) => {
    setLoadingEvent(true);
    setEventError('');
    try {
      const res = await api.get<Event>(`/events/${event.id}`);
      if (res.data) setSelectedEvent(res.data);
    } catch {
      setEventError('Evento nao encontrado ou invalido.');
    } finally {
      setLoadingEvent(false);
    }
  };

  const handleValidation = async (qrPayload: string) => {
    if (validating || !selectedEvent) return;
    setValidating(true);
    try {
      const res = await api.post<ValidationResult>('/gate/validate', { qrPayload, eventId: selectedEvent.id });
      setResult(res.data);
    } catch (err: any) {
      setResult({ valid: false, error: { code: err.code || 'UNKNOWN', message: err.message || 'Erro' } });
    } finally {
      setValidating(false);
    }
  };

  const handleManualSubmit = () => {
    if (manualCode.trim()) { handleValidation(manualCode.trim()); setManualCode(''); }
  };

  const getResultDisplay = () => {
    if (!result) return null;
    if (result.valid) return { bg: 'bg-board-emerald', icon: '✓', title: 'ENTRADA LIBERADA', details: `${result.eventTitle || ''} • Assento: ${result.seatIdentifier || ''}` };
    const code = result.error?.code || '';
    if (code === 'TICKET_ALREADY_USED') return { bg: 'bg-board-gold', icon: '⚠', title: 'JA UTILIZADO', details: result.error?.message || '' };
    if (code === 'EVENT_NOT_ACTIVE') return { bg: 'bg-yellow-600', icon: '⏸', title: 'EVENTO NAO ATIVO', details: result.error?.message || '' };
    return { bg: 'bg-board-crimson', icon: '✗', title: 'INGRESSO INVALIDO', details: result.error?.message || '' };
  };

  const display = getResultDisplay();

  if (!selectedEvent) {
    return (
      <div className="min-h-screen bg-board-navy py-12 px-4">
        <div className="max-w-lg mx-auto">
          <motion.h1 initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="font-display text-3xl font-bold text-board-parchment text-center mb-2">
            Portaria
          </motion.h1>
          <p className="text-board-parchment/60 text-center mb-8">Selecione o evento para validar ingressos</p>
          {eventError && <div className="bg-board-crimson/20 border border-board-crimson/30 text-board-crimson rounded-lg p-3 mb-4 text-center text-sm">{eventError}</div>}
          {loadingEvents ? (
            <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="bg-board-navy-light rounded-lg p-4 animate-pulse h-20" />)}</div>
          ) : events.length === 0 ? (
            <div className="text-center text-board-parchment/40 py-8">Nenhum evento disponivel.</div>
          ) : (
            <div className="space-y-3">
              {events.map(event => (
                <motion.button key={event.id} whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.99 }} onClick={() => handleSelectEvent(event)} disabled={loadingEvent}
                  className="w-full text-left bg-board-navy-light rounded-lg p-4 border border-board-gold/20 hover:border-board-gold/50 transition-colors disabled:opacity-50">
                  <h3 className="font-display text-lg font-semibold text-board-parchment">{event.title}</h3>
                  <div className="flex gap-4 mt-1 text-sm text-board-parchment/50">
                    <span>{new Date(event.date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</span>
                    <span>{event.venueName}</span>
                  </div>
                </motion.button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-board-navy py-12 px-4 relative">
      <AnimatePresence>
        {display && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className={`fixed inset-0 z-50 flex flex-col items-center justify-center ${display.bg}`}>
            <span className="text-8xl text-white mb-4">{display.icon}</span>
            <h2 className="font-display text-4xl font-bold text-white mb-2">{display.title}</h2>
            <p className="text-white/80 text-lg">{display.details}</p>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="max-w-md mx-auto">
        <div className="bg-board-navy-light rounded-lg p-4 border border-board-gold/30 mb-6 text-center">
          <p className="text-board-parchment/50 text-xs uppercase tracking-wider">Validando para</p>
          <h2 className="font-display text-xl font-bold text-board-gold mt-1">{selectedEvent.title}</h2>
          <p className="text-board-parchment/60 text-sm mt-1">{selectedEvent.venueName}</p>
          <button onClick={() => { setSelectedEvent(null); setScannerActive(false); }} className="mt-3 text-board-parchment/40 text-xs hover:text-board-parchment/70 underline">Trocar evento</button>
        </div>
        <div className="bg-board-navy-light rounded-card p-4 mb-6 border border-board-gold/20">
          <div id="qr-reader" className="w-full rounded-lg overflow-hidden mb-3" style={{ minHeight: scannerActive ? 300 : 0 }} />
          {!scannerActive ? (
            <button onClick={() => setScannerActive(true)} className="btn-gold w-full">Ativar Camera</button>
          ) : (
            <p className="text-board-parchment/60 text-sm text-center">Aponte para o QR Code</p>
          )}
        </div>
        <div className="bg-board-navy-light rounded-card p-6 border border-board-gold/20">
          <h2 className="text-board-parchment font-medium mb-3">Ou digite o codigo:</h2>
          <input type="text" value={manualCode} onChange={e => setManualCode(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleManualSubmit()}
            placeholder="Cole o payload do QR aqui..." className="w-full px-4 py-3 rounded-lg bg-board-navy border border-board-gold/30 text-board-parchment placeholder-board-parchment/30 focus:outline-none focus:ring-2 focus:ring-board-gold/50 font-ticket text-sm" />
          <button onClick={handleManualSubmit} disabled={validating} className="btn-gold w-full mt-3">{validating ? 'Validando...' : 'Validar'}</button>
        </div>
      </div>
    </div>
  );
}
