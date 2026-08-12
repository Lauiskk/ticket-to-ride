import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { GiTicket } from 'react-icons/gi';
import { useEventDetail, useAvailableSeats } from '../hooks/useEvents';
import { useSeatSocket } from '../hooks/useSeatSocket';
import { SeatMap } from '../components/SeatMap';
import { GeneralAdmissionSelector } from '../components/GeneralAdmissionSelector';
import { PaymentModal } from '../components/PaymentModal';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import type { Reservation } from '../types';

/**
 * Turn a backend error into something a buyer can act on.
 * The API speaks English and includes internal ids ("Seat 8f2c… is no longer
 * available") — useful in a log, useless in a red box on a checkout page.
 */
function reserveErrorMessage(err: { code?: string; statusCode?: number }): string {
  switch (err.code) {
    case 'SEAT_UNAVAILABLE':
      return 'Alguém garantiu esse lugar primeiro. Escolha outro no mapa — ele já foi atualizado.';
    case 'BAD_REQUEST':
      return 'Esses assentos não estão mais disponíveis para este evento.';
    case 'UNAUTHORIZED':
      return 'Sua sessão expirou. Entre novamente para continuar a compra.';
    case 'FORBIDDEN':
      return 'Sua conta não pode comprar ingressos.';
    default:
      return 'Não foi possível concluir a reserva. Tente novamente em instantes.';
  }
}

export function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: event, isLoading: loadingEvent, isError } = useEventDetail(id);
  const { data: seats, isLoading: loadingSeats, refetch: refetchSeats } = useAvailableSeats(id);
  const { connected } = useSeatSocket(id);

  const [isReserving, setIsReserving] = useState(false);
  const [error, setError] = useState('');
  const [reservationData, setReservationData] = useState<{
    reservationId: string;
    clientSecret: string;
    amount: number;
    currency: string;
    expiresAt: string;
  } | null>(null);

  const handleReserve = async (seatIds: string[]) => {
    if (!user) {
      navigate('/login');
      return;
    }
    if (user.role !== 'client') {
      setError('Apenas clientes podem reservar ingressos.');
      return;
    }

    setIsReserving(true);
    setError('');

    let reservationId: string | null = null;
    try {
      const res = await api.post<Reservation>('/reservations', { eventId: id, seatIds });
      reservationId = res.data.id;

      const paymentRes = await api.post<{ clientSecret: string; paymentId: string }>(
        `/payments/${res.data.id}`,
      );

      setReservationData({
        reservationId: res.data.id,
        clientSecret: paymentRes.data.clientSecret,
        amount: Number(res.data.totalAmount),
        currency: res.data.currency || 'BRL',
        expiresAt: res.data.expiresAt,
      });
    } catch (err: any) {
      // The seats were locked but checkout never opened — don't leave them hanging
      if (reservationId) {
        await api.post(`/reservations/${reservationId}/cancel`).catch(() => {});
      }
      setError(reserveErrorMessage(err));
      refetchSeats();
    } finally {
      setIsReserving(false);
    }
  };

  /** Buyer gave up: release the seats now instead of holding them for 10 minutes. */
  const handleCancelCheckout = useCallback(async () => {
    const current = reservationData;
    setReservationData(null);

    if (current) {
      try {
        await api.post(`/reservations/${current.reservationId}/cancel`);
      } catch {
        // Worst case the expiration sweep releases them
      }
    }
    refetchSeats();
  }, [reservationData, refetchSeats]);

  if (loadingEvent || loadingSeats) {
    return (
      <div className="min-h-screen bg-board-cream py-12 px-4">
        <div className="max-w-4xl mx-auto">
          <div className="card-game p-8 animate-pulse space-y-4">
            <div className="h-8 bg-board-parchment-dark/30 rounded w-2/3" />
            <div className="h-4 bg-board-parchment-dark/20 rounded w-1/2" />
            <div className="h-4 bg-board-parchment-dark/20 rounded w-3/4" />
            <div className="h-64 bg-board-parchment-dark/20 rounded mt-6" />
          </div>
        </div>
      </div>
    );
  }

  if (isError || !event) {
    return (
      <div className="min-h-screen bg-board-cream py-12 px-4 text-center">
        <p className="text-board-crimson text-lg mt-20">Evento não encontrado.</p>
      </div>
    );
  }

  const availableSeats = seats?.filter((s) => s.status === 'available') || [];

  return (
    <div className="min-h-screen bg-board-cream py-12 px-4">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="max-w-4xl mx-auto">
        {/* Event Info */}
        <div className="card-game p-8 mb-8">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h1 className="font-display text-3xl font-bold text-board-navy mb-2">{event.title}</h1>
              <p className="text-board-navy/60">
                {event.venueName}
                {event.venueCity ? `, ${event.venueCity}` : ''}
              </p>
            </div>
            <div className="text-right">
              <span className="font-display text-2xl font-bold text-board-crimson">
                {new Intl.NumberFormat('pt-BR', {
                  style: 'currency',
                  currency: event.currency || 'BRL',
                }).format(Number(event.price))}
              </span>
              <p className="text-board-navy/50 text-sm">por ingresso</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-4 text-sm text-board-navy/70 mb-4">
            <span>
              📅{' '}
              {new Date(event.date).toLocaleDateString('pt-BR', {
                weekday: 'long',
                day: '2-digit',
                month: 'long',
                year: 'numeric',
              })}
            </span>
            <span>📍 {event.venueAddress}</span>
            <span>🎫 {event.seatingType === 'numbered' ? 'Assentos Numerados' : 'Pista Geral'}</span>
          </div>

          <p className="text-board-navy/70 leading-relaxed">{event.description}</p>
        </div>

        {/* Error */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            role="alert"
            className="flex items-start gap-3 bg-board-crimson/10 border border-board-crimson/30 text-board-crimson rounded-lg p-4 mb-6"
          >
            <span aria-hidden className="text-lg leading-none mt-0.5">
              ⚠
            </span>
            <p className="flex-1 text-sm">{error}</p>
            <button
              onClick={() => setError('')}
              aria-label="Fechar aviso"
              className="text-board-crimson/50 hover:text-board-crimson"
            >
              ✕
            </button>
          </motion.div>
        )}

        {/* Seat Selection */}
        <div className="card-game p-8">
          <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
            <h2 className="font-display text-2xl font-semibold text-board-navy flex items-center gap-2">
              <GiTicket className="text-board-gold" />
              {event.seatingType === 'numbered' ? 'Escolha seus assentos' : 'Selecione a quantidade'}
            </h2>
            <span
              className={`text-xs flex items-center gap-1.5 ${
                connected ? 'text-board-emerald' : 'text-board-navy/40'
              }`}
              title={
                connected
                  ? 'Disponibilidade atualizando em tempo real'
                  : 'Sem conexão ao vivo — atualizando periodicamente'
              }
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  connected ? 'bg-board-emerald animate-pulse' : 'bg-board-navy/30'
                }`}
              />
              {connected ? 'Disponibilidade ao vivo' : 'Atualização periódica'}
            </span>
          </div>

          {event.seatingType === 'numbered' ? (
            <SeatMap
              seats={seats || []}
              price={Number(event.price)}
              currency="R$"
              onReserve={handleReserve}
              isReserving={isReserving}
            />
          ) : (
            <GeneralAdmissionSelector
              availableCount={availableSeats.length}
              price={Number(event.price)}
              currency="R$"
              seatIds={availableSeats.map((s) => s.id)}
              onReserve={handleReserve}
              isReserving={isReserving}
            />
          )}
        </div>

        {/* Checkout */}
        {reservationData && (
          <PaymentModal
            reservationId={reservationData.reservationId}
            clientSecret={reservationData.clientSecret}
            amount={reservationData.amount}
            currency={reservationData.currency}
            expiresAt={reservationData.expiresAt}
            onSuccess={() => {
              setReservationData(null);
              navigate('/my-tickets');
            }}
            onCancel={handleCancelCheckout}
          />
        )}
      </motion.div>
    </div>
  );
}
