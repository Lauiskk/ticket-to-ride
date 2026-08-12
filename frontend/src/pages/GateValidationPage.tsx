import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { ValidationResult, GateEventSummary } from '../types';

/**
 * Gate operator screen (SPEC_CP11).
 *
 * Two steps, in this order, on purpose: pick the door you are standing at, then
 * read tickets. Before, any UUID typed into a box opened the camera — and a
 * ticket for the wrong event looks identical to a valid one until the server
 * says otherwise. Choosing from the gate's own agenda makes "which event" a
 * fact instead of a guess.
 *
 * Designed for a phone held in one hand, at a door, at night: big targets, the
 * verdict takes over the whole screen, and colour alone never carries meaning
 * (icon + word + text always agree).
 */

/** How long the verdict stays up before the scanner is ready again. */
const VERDICT_MS = 3000;

const HALF_PRICE_LABEL: Record<string, string> = {
  student: 'Estudante',
  senior: '60+ anos',
  pcd: 'PCD',
};

interface Verdict {
  tone: 'ok' | 'warn' | 'deny' | 'idle';
  icon: string;
  title: string;
  details: string;
  /** Extra step the operator must perform before letting the person through. */
  checkDocument?: { category: string; document: string };
}

function verdictFor(result: ValidationResult): Verdict {
  if (result.valid) {
    return {
      tone: 'ok',
      icon: '✓',
      title: 'ENTRADA LIBERADA',
      details: [result.eventTitle, result.seatIdentifier && `Assento ${result.seatIdentifier}`]
        .filter(Boolean)
        .join(' · '),
      // A half-price ticket is valid AND conditional — the operator still has
      // to see the document. Showing it as a separate panel (not a colour
      // change) keeps "the ticket is real" and "now check the card" distinct.
      checkDocument: result.isHalfPrice
        ? {
            category: HALF_PRICE_LABEL[result.halfPriceCategory ?? ''] ?? 'Meia-entrada',
            document: result.holderDocumentMasked ?? '',
          }
        : undefined,
    };
  }

  switch (result.error?.code) {
    case 'TICKET_ALREADY_USED':
      return {
        tone: 'warn',
        icon: '⟳',
        title: 'JÁ UTILIZADO',
        details: 'Este ingresso já deu entrada. Não liberar.',
      };
    case 'EVENT_NOT_ACTIVE':
      return {
        tone: 'warn',
        icon: '◷',
        title: 'FORA DO HORÁRIO',
        details: 'A entrada para este evento não está aberta agora.',
      };
    case 'INVALID_TICKET':
      return {
        tone: 'deny',
        icon: '✕',
        title: 'INGRESSO INVÁLIDO',
        details: result.error?.message?.includes('different event')
          ? 'Este ingresso é de outro evento.'
          : 'Assinatura inválida ou ingresso inexistente.',
      };
    default:
      return {
        tone: 'deny',
        icon: '✕',
        title: 'INGRESSO INVÁLIDO',
        details: result.error?.message || 'Não foi possível validar.',
      };
  }
}

const TONE_BG: Record<Verdict['tone'], string> = {
  ok: 'bg-board-emerald',
  warn: 'bg-board-gold',
  deny: 'bg-board-crimson',
  idle: 'bg-board-navy',
};

export function GateValidationPage() {
  const [selected, setSelected] = useState<GateEventSummary | null>(null);
  const [manualCode, setManualCode] = useState('');
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [validating, setValidating] = useState(false);
  const [scannerActive, setScannerActive] = useState(false);

  const {
    data: events,
    isLoading,
    isError,
    refetch,
  } = useQuery({
    queryKey: ['gate-events'],
    queryFn: async () => {
      const res = await api.get<GateEventSummary[]>('/gate/events');
      return res.data;
    },
    refetchInterval: 60000,
  });

  // Clear the verdict so the operator can scan the next person.
  // A half-price ticket needs a document check, which takes longer than reading
  // a green screen — so it stays up until the operator dismisses it.
  useEffect(() => {
    if (!result) return;
    if (result.valid && result.isHalfPrice) return;
    const timer = setTimeout(() => setResult(null), VERDICT_MS);
    return () => clearTimeout(timer);
  }, [result]);

  const handleValidation = useCallback(
    async (qrPayload: string) => {
      if (validating || !selected) return;
      setValidating(true);
      try {
        const res = await api.post<ValidationResult>('/gate/validate', {
          qrPayload,
          eventId: selected.id,
        });
        setResult(res.data);
      } catch (err: any) {
        setResult({
          valid: false,
          error: { code: err.code || 'UNKNOWN', message: err.message || 'Erro de conexão' },
        } as ValidationResult);
      } finally {
        setValidating(false);
        refetch();
      }
    },
    [validating, selected, refetch],
  );

  // Camera scanner — only ever mounted after an event is chosen
  useEffect(() => {
    if (!selected || !scannerActive) return;
    let scanner: any = null;

    (async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        scanner = new Html5Qrcode('qr-reader');
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decoded: string) => handleValidation(decoded),
          () => {},
        );
      } catch {
        setScannerActive(false);
      }
    })();

    return () => {
      if (scanner?.isScanning) scanner.stop().catch(() => {});
    };
  }, [selected, scannerActive, handleValidation]);

  // ─── Step 1: which door am I at? ──────────────────────────────────────────

  if (!selected) {
    return (
      <div className="min-h-screen bg-board-navy py-10 px-4">
        <div className="max-w-lg mx-auto">
          <h1 className="font-display text-3xl font-bold text-board-parchment text-center">
            Portaria
          </h1>
          <p className="text-board-parchment/50 text-center mt-1 mb-8">
            Escolha o evento que você está validando
          </p>

          {isLoading && (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="bg-board-navy-light rounded-lg h-24 animate-pulse" />
              ))}
            </div>
          )}

          {isError && (
            <div className="text-center py-10">
              <p className="text-board-crimson mb-4">Não foi possível carregar a agenda.</p>
              <button onClick={() => refetch()} className="btn-gold">
                Tentar novamente
              </button>
            </div>
          )}

          {events && events.length === 0 && (
            <p className="text-center text-board-parchment/40 py-10">
              Nenhum evento publicado no momento.
            </p>
          )}

          <div className="space-y-3">
            {events?.map((event) => (
              <motion.button
                key={event.id}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                onClick={() => setSelected(event)}
                className={`w-full text-left rounded-lg p-4 border transition-colors ${
                  event.entryOpen
                    ? 'bg-board-navy-light border-board-emerald/50 hover:border-board-emerald'
                    : 'bg-board-navy-light/50 border-board-gold/10 hover:border-board-gold/30'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="font-display text-lg font-semibold text-board-parchment leading-tight">
                      {event.title}
                    </h2>
                    <p className="text-board-parchment/50 text-sm mt-1">
                      {event.venueName} ·{' '}
                      {new Date(event.date).toLocaleString('pt-BR', {
                        day: '2-digit',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  </div>
                  {event.entryOpen ? (
                    <span className="flex-shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-full bg-board-emerald/20 text-board-emerald text-[11px] font-bold uppercase tracking-wide">
                      <span className="w-1.5 h-1.5 rounded-full bg-board-emerald animate-pulse" />
                      Entrada aberta
                    </span>
                  ) : (
                    <span className="flex-shrink-0 px-2 py-1 rounded-full bg-board-parchment/10 text-board-parchment/40 text-[11px] font-bold uppercase tracking-wide">
                      Fechado
                    </span>
                  )}
                </div>

                {/* Queue progress — the number an operator actually watches */}
                <div className="mt-3 flex items-center gap-3">
                  <div className="flex-1 h-1.5 rounded-full bg-board-navy overflow-hidden">
                    <div
                      className="h-full bg-board-gold rounded-full transition-all"
                      style={{
                        width: `${
                          event.ticketsIssued > 0
                            ? Math.round((event.ticketsValidated / event.ticketsIssued) * 100)
                            : 0
                        }%`,
                      }}
                    />
                  </div>
                  <span className="text-board-parchment/50 text-xs font-ticket whitespace-nowrap">
                    {event.ticketsValidated}/{event.ticketsIssued} entraram
                  </span>
                </div>
              </motion.button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ─── Step 2: read tickets ─────────────────────────────────────────────────

  const verdict = result ? verdictFor(result) : null;

  return (
    <div className="min-h-screen bg-board-navy py-10 px-4">
      <AnimatePresence>
        {verdict && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            role="status"
            aria-live="assertive"
            className={`fixed inset-0 z-50 flex flex-col items-center justify-center px-6 text-center ${TONE_BG[verdict.tone]}`}
          >
            <span className="text-8xl text-white mb-4" aria-hidden>
              {verdict.icon}
            </span>
            <h2 className="font-display text-4xl font-bold text-white">{verdict.title}</h2>
            <p className="text-white/80 text-lg mt-2 max-w-sm">{verdict.details}</p>

            {verdict.checkDocument && (
              <div className="mt-6 bg-black/25 rounded-xl px-6 py-4 max-w-sm w-full">
                <p className="font-display text-2xl font-bold text-white tracking-wide">
                  MEIA — CONFERIR DOCUMENTO
                </p>
                <p className="text-white/85 mt-1">{verdict.checkDocument.category}</p>
                <p className="font-ticket text-lg text-white mt-2 tracking-widest">
                  {verdict.checkDocument.document}
                </p>
                <p className="text-white/60 text-xs mt-2">
                  Confira os dígitos visíveis contra o documento original.
                </p>
                <button
                  onClick={() => setResult(null)}
                  className="mt-4 w-full py-3 rounded-lg bg-white text-board-navy font-bold"
                >
                  Documento conferido — próximo
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="max-w-md mx-auto space-y-6">
        {/* Which door — always visible, so nobody validates the wrong event */}
        <div
          className={`rounded-lg p-4 border text-center ${
            selected.entryOpen
              ? 'bg-board-navy-light border-board-emerald/40'
              : 'bg-board-navy-light border-board-gold/30'
          }`}
        >
          <p className="text-board-parchment/40 text-[11px] uppercase tracking-[0.2em]">
            Validando para
          </p>
          <h2 className="font-display text-xl font-bold text-board-gold mt-1 leading-tight">
            {selected.title}
          </h2>
          <p className="text-board-parchment/50 text-sm mt-1">{selected.venueName}</p>

          {!selected.entryOpen && (
            <p className="mt-3 text-board-gold text-sm bg-board-gold/10 rounded px-3 py-2">
              A entrada deste evento não está aberta. Qualquer leitura será recusada.
            </p>
          )}

          <button
            onClick={() => {
              setSelected(null);
              setScannerActive(false);
            }}
            className="mt-3 text-board-parchment/40 text-xs hover:text-board-parchment/70 underline"
          >
            Trocar evento
          </button>
        </div>

        {/* Camera */}
        <div className="bg-board-navy-light rounded-card p-4 border border-board-gold/20">
          <div
            id="qr-reader"
            className="w-full rounded-lg overflow-hidden mb-3"
            style={{ minHeight: scannerActive ? 300 : 0 }}
          />
          {!scannerActive ? (
            <button onClick={() => setScannerActive(true)} className="btn-gold w-full py-4 text-lg">
              Ativar câmera
            </button>
          ) : (
            <p className="text-board-parchment/60 text-sm text-center py-2">
              Aponte para o QR Code do ingresso
            </p>
          )}
        </div>

        {/* Manual fallback — cracked screens, dead cameras, printed tickets */}
        <div className="bg-board-navy-light rounded-card p-5 border border-board-gold/20">
          <label htmlFor="manual-code" className="block text-board-parchment font-medium mb-2">
            Ou digite o código
          </label>
          <input
            id="manual-code"
            type="text"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && manualCode.trim()) {
                handleValidation(manualCode.trim());
                setManualCode('');
              }
            }}
            placeholder="Cole o conteúdo do QR"
            className="w-full px-4 py-3 rounded-lg bg-board-navy border border-board-gold/30 text-board-parchment placeholder-board-parchment/30 focus:outline-none focus:ring-2 focus:ring-board-gold/50 font-ticket text-sm"
          />
          <button
            onClick={() => {
              if (!manualCode.trim()) return;
              handleValidation(manualCode.trim());
              setManualCode('');
            }}
            disabled={validating || !manualCode.trim()}
            className="btn-gold w-full mt-3 py-4 text-lg disabled:opacity-40"
          >
            {validating ? 'Validando...' : 'Validar'}
          </button>
        </div>
      </div>
    </div>
  );
}
