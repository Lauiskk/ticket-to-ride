import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { GiTicket } from 'react-icons/gi';
import { useEventDetail, useAvailableSeats } from '../hooks/useEvents';
import { SeatMap } from '../components/SeatMap';
import { GeneralAdmissionSelector } from '../components/GeneralAdmissionSelector';
import { PaymentModal } from '../components/PaymentModal';
import { useAuth } from '../context/AuthContext';
import { api } from '../lib/api';
import type { Reservation } from '../types';

export function EventDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: event, isLoading: loadingEvent, isError } = useEventDetail(id);
  const { data: seats, isLoading: loadingSeats, refetch: refetchSeats } = useAvailableSeats(id);
  const [isReserving, setIsReserving] = useState(false);
  const [error, setError] = useState('');
  const [showPaymentModal, setShowPaymentModal] = useState(false);
  const [reservationData, setReservationData] = useState<{
    reservationId: string;
    clientSecret: string;
    amount: number;
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
    try {
      const res = await api.post<Reservation>('/reservations', { eventId: id, seatIds });
      // Call payment API to get clientSecret
      const paymentRes = await api.post<{ clientSecret: string; paymentId: string }>(`/payments/${res.data.id}`);
      setReservationData({
        reservationId: res.data.id,
        clientSecret: paymentRes.data.clientSecret,
        amount: res.data.totalAmount,
        expiresAt: res.data.expiresAt,
      });
      setShowPaymentModal(true);
      // Refetch seats to update visual state
      refetchSeats();
    } catch (err: any) {
      setError(err.message || 'Não foi possível reservar. Tente novamente.');
      // Refetch seats to restore visual state on error
      refetchSeats();
    } finally {
      setIsReserving(false);
    }
  };

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
              <p className="text-board-navy/60">{event.venueName}{event.venueCity ? `, ${event.venueCity}` : ''}</p>
            </div>
            <div className="text-right">
              <span className="font-display text-2xl font-bold text-board-crimson">
                R$ {Number(event.price).toFixed(2)}
              </span>
              <p className="text-board-navy/50 text-sm">por ingresso</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-4 text-sm text-board-navy/70 mb-4">
            <span>📅 {new Date(event.date).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}</span>
            <span>📍 {event.venueAddress}</span>
            <span>🎫 {event.seatingType === 'numbered' ? 'Assentos Numerados' : 'Pista Geral'}</span>
          </div>

          <p className="text-board-navy/70 leading-relaxed">{event.description}</p>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-board-crimson/10 border border-board-crimson/30 text-board-crimson rounded-lg p-4 mb-6 text-center">
            {error}
          </div>
        )}

        {/* Seat Selection */}
        <div className="card-game p-8">
          <h2 className="font-display text-2xl font-semibold text-board-navy mb-6 flex items-center gap-2">
            <GiTicket className="text-board-gold" />
            {event.seatingType === 'numbered' ? 'Escolha seus assentos' : 'Selecione a quantidade'}
          </h2>

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

        {/* Payment Modal */}
        {showPaymentModal && reservationData && (
          <PaymentModal
            reservationId={reservationData.reservationId}
            clientSecret={reservationData.clientSecret}
            amount={reservationData.amount}
            expiresAt={reservationData.expiresAt}
            onSuccess={() => {
              setShowPaymentModal(false);
              setReservationData(null);
              // Navigate to my tickets
              navigate('/my-tickets');
            }}
            onCancel={() => {
              setShowPaymentModal(false);
              setReservationData(null);
              // Refetch seats to restore availability
              refetchSeats();
            }}
          />
        )}
      </motion.div>
    </div>
  );
}
