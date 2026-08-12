import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'react-qr-code';
import { api } from '../lib/api';
import { useTicketSocket } from '../hooks/useTicketSocket';
import type { Ticket } from '../types';

/**
 * Single ticket, full screen (SPEC_CP10 RF-7 / AC-8).
 *
 * Deliberately shaped like a physical stub rather than a dashboard card: this is
 * the screen someone holds up at a gate, in a queue, probably in the dark. So the
 * QR gets the whole top half at high contrast (white field, no decoration behind
 * it — scanners hate texture), and everything else is subordinate to it.
 * The perforation line is where a real stub tears; the seat sits on the "keep"
 * side because that is the part the buyer looks for.
 */

const STATUS: Record<string, { label: string; note: string; className: string }> = {
  active: {
    label: 'Válido',
    note: 'Apresente este QR Code na entrada.',
    className: 'bg-board-emerald text-white',
  },
  used: {
    label: 'Utilizado',
    note: 'Este ingresso já deu entrada no evento.',
    className: 'bg-board-navy text-board-parchment',
  },
  invalidated: {
    label: 'Invalidado',
    note: 'Transferido para outra pessoa — não dá acesso.',
    className: 'bg-board-crimson text-white',
  },
};

export function TicketDetailPage() {
  const { ticketId } = useParams<{ ticketId: string }>();
  const [shareUrl, setShareUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [sharing, setSharing] = useState(false);

  const {
    data: ticket,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ['ticket', ticketId],
    queryFn: async () => {
      const res = await api.get<Ticket>(`/tickets/${ticketId}`);
      return res.data;
    },
    enabled: !!ticketId,
  });

  // O evento vem embutido no ingresso — uma requisição a menos, e a tela nunca
  // fica meio renderizada esperando o título chegar.
  const event = ticket?.event ?? null;

  // Esta é A tela que fica aberta na portaria, na mão de quem vai entrar. Sem
  // isso ela continua dizendo "Válido" depois que o QR já foi lido (SPEC_CP18).
  useTicketSocket([ticket?.eventId]);

  const handleShare = async () => {
    if (!ticket) return;
    setSharing(true);
    try {
      const res = await api.post<{ shareUrl: string }>(`/sharing/tickets/${ticket.id}/share`);
      setShareUrl(res.data.shareUrl);
    } catch {
      setShareUrl('');
    } finally {
      setSharing(false);
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-board-cream py-12 px-4">
        <div className="max-w-md mx-auto ticket-card p-8 animate-pulse space-y-4">
          <div className="h-64 bg-board-parchment-dark/30 rounded" />
          <div className="h-6 bg-board-parchment-dark/30 rounded w-2/3" />
          <div className="h-4 bg-board-parchment-dark/20 rounded w-1/2" />
        </div>
      </div>
    );
  }

  if (isError || !ticket) {
    return (
      <div className="min-h-screen bg-board-cream py-12 px-4 text-center">
        <p className="text-board-crimson text-lg mt-20 mb-4">Ingresso não encontrado.</p>
        <Link to="/my-tickets" className="btn-primary inline-block">
          Voltar aos meus ingressos
        </Link>
      </div>
    );
  }

  const status = STATUS[ticket.status] ?? {
    label: ticket.status,
    note: '',
    className: 'bg-board-parchment-dark text-board-navy',
  };

  return (
    <div className="min-h-screen bg-board-cream py-10 px-4">
      <div className="max-w-md mx-auto">
        <Link
          to="/my-tickets"
          className="inline-flex items-center gap-1 text-board-navy/50 hover:text-board-navy text-sm mb-4 transition-colors"
        >
          ← Meus ingressos
        </Link>

        <motion.article
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', damping: 22, stiffness: 220 }}
          className="bg-board-parchment rounded-card shadow-card overflow-hidden border border-board-parchment-dark"
        >
          {/* Stub header — the event this ticket belongs to */}
          <header className="bg-board-navy px-6 py-4 text-center">
            <p className="text-board-gold/70 text-[11px] uppercase tracking-[0.2em]">
              Ticket to Ride
            </p>
            <h1 className="font-display text-xl font-bold text-board-parchment mt-1 leading-tight">
              {event?.title ?? 'Carregando evento...'}
            </h1>
            {event && (
              <p className="text-board-parchment/60 text-sm mt-1">
                {new Date(event.date).toLocaleDateString('pt-BR', {
                  weekday: 'short',
                  day: '2-digit',
                  month: 'long',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            )}
          </header>

          {/* The QR gets a clean white field — scanners need contrast, not texture */}
          <div className="bg-white px-6 py-8 flex flex-col items-center">
            <QRCode
              value={ticket.qrPayload}
              size={232}
              level="M"
              aria-label="QR Code do ingresso"
            />
            <p className="font-ticket text-xs text-board-navy/50 mt-4 tracking-wider break-all text-center">
              {ticket.ticketCode}
            </p>
          </div>

          {/* Perforation */}
          <div className="relative h-6 bg-board-parchment">
            <div className="absolute -left-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-board-cream" />
            <div className="absolute -right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-board-cream" />
            <div className="absolute inset-x-5 top-1/2 border-t-2 border-dashed border-board-parchment-dark" />
          </div>

          {/* Keep side */}
          <div className="px-6 pb-6 pt-2 space-y-4">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-board-navy/50 text-[11px] uppercase tracking-wider">Assento</p>
                <p className="font-display text-2xl font-bold text-board-navy leading-tight">
                  {ticket.seatIdentifier}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <span
                  className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide ${status.className}`}
                >
                  {status.label}
                </span>
                {ticket.isHalfPrice && (
                  <span className="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide bg-board-crimson text-white">
                    Meia
                  </span>
                )}
              </div>
            </div>

            {event && (
              <div>
                <p className="text-board-navy/50 text-[11px] uppercase tracking-wider">Local</p>
                <p className="text-board-navy text-sm">
                  {event.venueName}
                  {event.venueCity ? ` — ${event.venueCity}` : ''}
                </p>
              </div>
            )}

            <p className="text-board-navy/60 text-sm border-t border-board-parchment-dark pt-3">
              {status.note}
            </p>

            {ticket.isHalfPrice && ticket.status === 'active' && (
              <p className="text-sm text-board-crimson bg-board-crimson/10 rounded-lg px-3 py-2.5">
                <strong>Meia-entrada.</strong> Leve o documento original que você declarou — sem
                ele a portaria pode recusar a entrada.
              </p>
            )}

            {ticket.status === 'active' && (
              <div className="space-y-2">
                <button
                  onClick={handleShare}
                  disabled={sharing}
                  className="btn-secondary w-full text-sm py-2 disabled:opacity-50"
                >
                  {sharing ? 'Gerando link...' : 'Compartilhar ingresso'}
                </button>

                {shareUrl && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-1">
                    <div className="flex gap-2">
                      <input
                        readOnly
                        value={shareUrl}
                        onFocus={(e) => e.currentTarget.select()}
                        className="flex-1 min-w-0 px-3 py-2 rounded border border-board-parchment-dark bg-white text-xs font-ticket"
                      />
                      <button onClick={copy} className="btn-gold text-sm py-2 px-3 whitespace-nowrap">
                        {copied ? 'Copiado' : 'Copiar'}
                      </button>
                    </div>
                    <p className="text-board-navy/40 text-[11px]">
                      Quem abrir o link assume o ingresso e o seu é invalidado.
                    </p>
                  </motion.div>
                )}
              </div>
            )}
          </div>
        </motion.article>
      </div>
    </div>
  );
}
