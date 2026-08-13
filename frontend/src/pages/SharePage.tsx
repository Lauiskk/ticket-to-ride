import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GiTicket } from 'react-icons/gi';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';

/**
 * O outro lado do link de compartilhamento (SPEC_CP22).
 *
 * O backend gerava o link e sabia transferir o ingresso desde sempre; esta tela
 * é que não existia, então quem recebia abria a URL e caía numa rota sem
 * correspondência. Um recurso que só existe no servidor não existe.
 *
 * A tela mostra **antes** o que está sendo oferecido — evento, data, local e
 * assento — porque aceitar é irreversível: o ingresso de quem enviou é
 * invalidado no mesmo instante.
 */

interface SharePreview {
  status: 'active' | 'used' | 'expired' | 'not_transferable';
  seatIdentifier: string;
  expiresAt: string;
  event: {
    title: string;
    date: string;
    venueName: string;
    venueCity: string | null;
  } | null;
}

/** Cada recusa tem um motivo diferente, e a pessoa merece saber qual é. */
const RECUSA: Record<Exclude<SharePreview['status'], 'active'>, { titulo: string; texto: string }> = {
  used: {
    titulo: 'Este link já foi usado',
    texto: 'Alguém aceitou este ingresso antes. Cada link vale uma transferência só.',
  },
  expired: {
    titulo: 'Este link expirou',
    texto: 'Links de compartilhamento valem 48 horas. Peça um novo para quem enviou.',
  },
  not_transferable: {
    titulo: 'Este ingresso não pode mais ser transferido',
    texto: 'Ele já deu entrada no evento ou foi invalidado.',
  },
};

export function SharePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, isLoading: loadingUser } = useAuth();

  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['share', token],
    queryFn: async () => {
      const res = await api.get<SharePreview>(`/sharing/${token}`);
      return res.data;
    },
    enabled: !!token,
    retry: false,
  });

  const accept = async () => {
    setAccepting(true);
    setError('');
    try {
      await api.post(`/sharing/${token}/accept`);
      // A segunda porta pela qual um ingresso nasce (SPEC_CP24 RF-1). A lista em
      // cache é de antes da transferência; sem isto, quem recebe o ingresso vai
      // parar numa tela que ainda não sabe dele.
      queryClient.removeQueries({ queryKey: ['my-tickets'] });
      navigate('/my-tickets', { replace: true });
    } catch (err: any) {
      setError(err.message || 'Não foi possível aceitar este ingresso.');
    } finally {
      setAccepting(false);
    }
  };

  if (isLoading || loadingUser) {
    return (
      <Moldura>
        <div className="animate-pulse space-y-3">
          <div className="h-6 bg-board-parchment-dark/30 rounded w-2/3 mx-auto" />
          <div className="h-4 bg-board-parchment-dark/20 rounded w-1/2 mx-auto" />
        </div>
      </Moldura>
    );
  }

  if (isError || !data) {
    return (
      <Moldura>
        <h1 className="font-display text-2xl font-bold text-board-navy mb-2">Link inválido</h1>
        <p className="text-board-navy/60 mb-6">
          Este link de compartilhamento não existe. Confira se ele foi copiado inteiro.
        </p>
        <Link to="/events" className="btn-primary inline-block">
          Ver eventos
        </Link>
      </Moldura>
    );
  }

  if (data.status !== 'active') {
    const { titulo, texto } = RECUSA[data.status];
    return (
      <Moldura>
        <h1 className="font-display text-2xl font-bold text-board-navy mb-2">{titulo}</h1>
        <p className="text-board-navy/60 mb-6">{texto}</p>
        <Link to="/events" className="btn-primary inline-block">
          Ver eventos
        </Link>
      </Moldura>
    );
  }

  const evento = data.event;

  return (
    <Moldura>
      <GiTicket className="text-5xl text-board-gold mx-auto mb-3" />
      <p className="text-board-navy/50 text-sm uppercase tracking-[0.2em] mb-1">
        Alguém te passou um ingresso
      </p>
      <h1 className="font-display text-2xl font-bold text-board-navy leading-tight">
        {evento?.title ?? 'Evento'}
      </h1>

      {evento && (
        <p className="text-board-navy/60 mt-2">
          {new Date(evento.date).toLocaleString('pt-BR', {
            weekday: 'long',
            day: '2-digit',
            month: 'long',
            hour: '2-digit',
            minute: '2-digit',
          })}
          <br />
          {evento.venueName}
          {evento.venueCity ? ` — ${evento.venueCity}` : ''}
        </p>
      )}

      <p className="mt-4 inline-block bg-board-parchment px-4 py-2 rounded-lg font-display text-lg font-bold text-board-navy">
        Assento {data.seatIdentifier}
      </p>

      {error && (
        <p role="alert" className="text-board-crimson text-sm mt-4">
          {error}
        </p>
      )}

      {/* Sem sessão, o destino é guardado: voltar para cá depois de entrar é o
          mínimo — o link é a única coisa que a pessoa tem (SPEC_CP22 RF-5). */}
      {!user ? (
        <div className="mt-6 space-y-2">
          <p className="text-board-navy/60 text-sm">
            Entre na sua conta para receber este ingresso.
          </p>
          <Link
            to={`/login?next=${encodeURIComponent(`/share/${token}`)}`}
            className="btn-primary inline-block"
          >
            Entrar e receber
          </Link>
        </div>
      ) : user.role !== 'client' ? (
        <p className="mt-6 text-board-navy/60 text-sm">
          Ingressos ficam com contas de cliente. Entre com a sua conta de cliente para receber
          este.
        </p>
      ) : (
        <div className="mt-6">
          <button onClick={accept} disabled={accepting} className="btn-primary disabled:opacity-50">
            {accepting ? 'Transferindo...' : 'Receber ingresso'}
          </button>
          <p className="text-board-navy/40 text-xs mt-3">
            Ao receber, o ingresso de quem enviou é invalidado na hora.
          </p>
        </div>
      )}
    </Moldura>
  );
}

function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-board-cream py-16 px-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md mx-auto ticket-card p-8 text-center"
      >
        {children}
      </motion.div>
    </div>
  );
}
