import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import QRCode from 'react-qr-code';
import { GiTicket } from 'react-icons/gi';
import { api } from '../lib/api';
import type { Ticket } from '../types';

export function MyTicketsPage() {
  const { data: tickets, isLoading, isError, refetch } = useQuery({
    queryKey: ['my-tickets'],
    queryFn: async () => {
      const res = await api.get<Ticket[]>('/tickets');
      return res.data;
    },
  });

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

                  {/* Ticket Info */}
                  <div className="flex-1">
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-display text-lg font-semibold text-board-navy">
                        Assento: {ticket.seatIdentifier}
                      </h3>
                      <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusBadge(ticket.status)}`}>
                        {getStatusLabel(ticket.status)}
                      </span>
                    </div>
                    <p className="text-board-navy/60 text-sm mb-1">Código: <span className="font-ticket">{ticket.ticketCode.slice(0, 8)}...</span></p>
                    <p className="text-board-navy/50 text-sm mb-4">
                      Comprado em {new Date(ticket.createdAt).toLocaleDateString('pt-BR')}
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
