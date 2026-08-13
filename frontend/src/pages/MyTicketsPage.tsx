import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'react-qr-code';
import { GiTicket } from 'react-icons/gi';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useTicketSocket } from '../hooks/useTicketSocket';
import type { Ticket } from '../types';

export function MyTicketsPage() {
  const { user } = useAuth();

  /*
    A chave carrega o dono (SPEC_CP24 RF-3).

    "Meus ingressos" é uma pergunta cuja resposta depende de quem pergunta, e o
    servidor responde pelo cookie — que é do navegador inteiro, não desta aba.
    Com a chave genérica, entrar com outra conta em outra aba fazia esta exibir
    a lista da conta errada até o cache envelhecer sozinho.
  */
  const { data: tickets, isLoading, isError, refetch } = useQuery({
    queryKey: ['my-tickets', user?.id],
    queryFn: async () => {
      const res = await api.get<Ticket[]>('/tickets');
      return res.data;
    },
  });

  // Listen on every event this person holds a ticket for, so the badge flips to
  // "Utilizado" the moment the gate reads it (SPEC_CP18 RF-2).
  const eventIds = useMemo(() => (tickets ?? []).map((t) => t.eventId), [tickets]);
  useTicketSocket(eventIds);

  const [shareLink, setShareLink] = useState<{ ticketId: string; url: string } | null>(null);
  const [sharing, setSharing] = useState<string | null>(null);

  const handleShare = async (ticketId: string) => {
    setSharing(ticketId);
    try {
      const res = await api.post<{ shareUrl: string }>(`/sharing/tickets/${ticketId}/share`);
      setShareLink({ ticketId, url: res.data.shareUrl });
    } catch {
      // Error handled by global handler
    } finally {
      setSharing(null);
    }
  };

  const copyLink = () => {
    if (shareLink) {
      navigator.clipboard.writeText(shareLink.url);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active': return 'bg-board-emerald/20 text-board-emerald';
      case 'used': return 'bg-board-navy/20 text-board-navy';
      case 'invalidated': return 'bg-board-crimson/20 text-board-crimson';
      default: return 'bg-board-parchment-dark text-board-navy/60';
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'active': return 'Válido';
      case 'used': return 'Utilizado';
      case 'invalidated': return 'Invalidado';
      default: return status;
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-board-cream py-12 px-4">
        <div className="max-w-4xl mx-auto space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="ticket-card p-6 animate-pulse flex gap-4">
              <div className="w-24 h-24 bg-board-parchment-dark/30 rounded" />
              <div className="flex-1 space-y-2">
                <div className="h-5 bg-board-parchment-dark/30 rounded w-2/3" />
                <div className="h-4 bg-board-parchment-dark/20 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="min-h-screen bg-board-cream py-12 px-4 text-center">
        <p className="text-board-crimson text-lg mt-20 mb-4">Erro ao carregar ingressos.</p>
        <button onClick={() => refetch()} className="btn-primary">Tentar novamente</button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-board-cream py-12 px-4">
      <div className="max-w-4xl mx-auto">
        <motion.h1 initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="section-title mb-8 flex items-center gap-3">
          <GiTicket className="text-board-gold" />
          Meus Ingressos
        </motion.h1>

        {!tickets || tickets.length === 0 ? (
          <div className="ticket-card p-8 text-center">
            <GiTicket className="text-5xl text-board-navy/20 mx-auto mb-4" />
            <p className="text-board-navy/60 text-lg mb-2">Nenhum ingresso ainda.</p>
            <p className="text-board-navy/40 text-sm">Explore eventos e garanta o seu!</p>
          </div>
        ) : (
          <div className="space-y-4">
            {tickets.map((ticket) => (
              <motion.div
                key={ticket.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="ticket-card p-6"
              >
                <div className="flex flex-col md:flex-row gap-6">
                  {/* QR Code */}
                  <div className="flex-shrink-0 mx-auto md:mx-0">
                    <div className="bg-white p-3 rounded-lg shadow-sm">
                      <QRCode value={ticket.qrPayload} size={120} />
                    </div>
                  </div>

                  {/* Ticket Info — the event leads, because that is what the
                      buyer is looking for. A seat code says nothing about
                      which show it belongs to. */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3 mb-1">
                      <h3 className="font-display text-lg font-semibold text-board-navy leading-tight">
                        {ticket.event?.title ?? 'Evento'}
                      </h3>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusBadge(ticket.status)}`}>
                          {getStatusLabel(ticket.status)}
                        </span>
                        {ticket.isHalfPrice && (
                          <span className="px-2 py-1 rounded text-xs font-bold bg-board-crimson text-white">
                            MEIA
                          </span>
                        )}
                      </div>
                    </div>

                    {ticket.event && (
                      <p className="text-board-navy/60 text-sm mb-1">
                        {new Date(ticket.event.date).toLocaleString('pt-BR', {
                          day: '2-digit',
                          month: 'long',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}{' '}
                        · {ticket.event.venueName}
                        {ticket.event.venueCity ? `, ${ticket.event.venueCity}` : ''}
                      </p>
                    )}

                    <p className="text-board-navy/70 text-sm font-medium mb-1">
                      Assento {ticket.seatIdentifier}
                    </p>
                    <p className="text-board-navy/45 text-xs mb-4 font-ticket">
                      {ticket.ticketCode.slice(0, 8)} · comprado em{' '}
                      {new Date(ticket.createdAt).toLocaleDateString('pt-BR')}
                    </p>

                    {/* Actions */}
                    <div className="flex gap-2 flex-wrap">
                      <Link to={`/my-tickets/${ticket.id}`} className="btn-primary text-sm py-2 px-4">
                        Abrir ingresso
                      </Link>
                      {ticket.status === 'active' && (
                        <button
                          onClick={() => handleShare(ticket.id)}
                          disabled={sharing === ticket.id}
                          className="btn-secondary text-sm py-2 px-4"
                        >
                          {sharing === ticket.id ? 'Gerando...' : 'Compartilhar'}
                        </button>
                      )}
                    </div>

                    {/* Share link */}
                    {shareLink?.ticketId === ticket.id && (
                      <div className="mt-3 flex gap-2">
                        <input
                          type="text"
                          value={shareLink.url}
                          readOnly
                          className="flex-1 px-3 py-2 rounded border border-board-parchment-dark bg-white text-sm font-ticket"
                        />
                        <button onClick={copyLink} className="btn-gold text-sm py-2 px-3">Copiar</button>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
