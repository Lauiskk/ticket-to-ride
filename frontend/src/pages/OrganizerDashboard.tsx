import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GiDiceSixFacesTwo } from 'react-icons/gi';
import { api } from '../lib/api';
import { EventWizard } from '../components/organizer/EventWizard';
import { useEventActions } from '../hooks/useEventActions';
import {
  EVENT_STATUS_LABEL,
  EVENT_STATUS_CLASS,
  PUBLISH_ACTION_LABEL,
  formatMoney,
} from '../lib/eventStatus';
import type { Event } from '../types';

/**
 * Organizer panel (SPEC_CP12 RF-5, RF-7).
 *
 * This used to be the buyer's event list with two extra buttons, which made the
 * organizer look like a customer browsing their own catalogue. It is now a box
 * office: every row is a house you can open to see how it is filling, and the
 * only actions are the ones a promoter actually takes — put on sale, cancel.
 */
export function OrganizerDashboard() {
  const queryClient = useQueryClient();
  const [showWizard, setShowWizard] = useState(false);
  /** Último evento criado, para explicar que ele nasceu rascunho. */
  const [justCreated, setJustCreated] = useState<{ id: string; title: string } | null>(null);

  const { data: events, isLoading } = useQuery({
    queryKey: ['my-events'],
    queryFn: async () => {
      const res = await api.get<Event[]>('/events/my/list');
      return res.data;
    },
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['my-events'] });

  const { putOnSale, cancelEvent, busyId, error } = useEventActions();

  const onSale = events?.filter((e) => e.status === 'published') ?? [];
  const drafts = events?.filter((e) => e.status === 'draft') ?? [];

  return (
    <div className="min-h-screen bg-board-cream py-12 px-4">
      <div className="max-w-4xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-wrap items-center justify-between gap-4 mb-8"
        >
          <h1 className="section-title flex items-center gap-3">
            <GiDiceSixFacesTwo className="text-board-gold" />
            Painel do organizador
          </h1>
          <button onClick={() => setShowWizard(true)} className="btn-primary">
            + Criar evento
          </button>
        </motion.div>

        {/* Summary */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[
            { label: 'À venda', value: onSale.length },
            { label: 'Rascunhos', value: drafts.length },
            { label: 'Total', value: events?.length ?? 0 },
          ].map((s) => (
            <div key={s.label} className="card-game p-5 text-center">
              <p className="text-board-navy/50 text-sm">{s.label}</p>
              <p className="font-display text-3xl font-bold text-board-navy mt-1">{s.value}</p>
            </div>
          ))}
        </div>

        {error && (
          <div role="alert" className="bg-board-crimson/10 border border-board-crimson/30 text-board-crimson rounded-lg p-4 mb-6 text-sm">
            {error}
          </div>
        )}

        {/* An event is born as a draft — it is NOT in the storefront yet.
            Without saying so, "criei e não apareceu" is the obvious reaction:
            the organizer looks for it in the shop and finds nothing. */}
        {justCreated && (
          <div
            role="status"
            className="bg-board-emerald/10 border border-board-emerald/30 rounded-lg p-4 mb-6 flex flex-wrap items-center gap-3"
          >
            <span className="text-board-emerald text-lg" aria-hidden>
              ✓
            </span>
            <p className="flex-1 text-sm text-board-navy">
              <strong>{justCreated.title}</strong> foi criado como{' '}
              <strong>rascunho</strong> — ainda não aparece para os clientes.
            </p>
            <button
              onClick={() => {
                putOnSale(justCreated.id);
                setJustCreated(null);
              }}
              className="btn-gold text-sm py-1.5 px-3"
            >
              {PUBLISH_ACTION_LABEL}
            </button>
            <button
              onClick={() => setJustCreated(null)}
              aria-label="Fechar aviso"
              className="text-board-navy/40 hover:text-board-navy"
            >
              ✕
            </button>
          </div>
        )}

        {/* Events */}
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="card-game p-6 h-24 animate-pulse" />
            ))}
          </div>
        ) : !events || events.length === 0 ? (
          /* Uma lista vazia não ensina nada. Aqui o organizador novo descobre
             de onde vêm os eventos e o que acontece depois de criar um
             (SPEC_CP17 RF-6). */
          <div className="card-game p-10">
            <p className="font-display text-xl font-semibold text-board-navy text-center mb-1">
              Sua bilheteria está vazia
            </p>
            <p className="text-board-navy/50 text-sm text-center mb-7">
              Os eventos aqui são <strong>seus</strong>: você define a casa, o preço e a política
              de meia-entrada.
            </p>

            <ol className="max-w-md mx-auto space-y-4 mb-8">
              {[
                {
                  title: 'Busque um show ou filme',
                  body: 'O catálogo do Ticketmaster e do TMDb preenche título, foto, local e data para você.',
                },
                {
                  title: 'Monte a casa',
                  body: 'Setores com fileiras (lugares marcados) ou por quantidade (pista), e o preço do ingresso.',
                },
                {
                  title: 'Coloque à venda',
                  body: 'O evento nasce como rascunho e só aparece para os clientes quando você mandar.',
                },
              ].map((step, i) => (
                <li key={step.title} className="flex gap-3">
                  <span className="flex-shrink-0 w-7 h-7 rounded-full bg-board-gold text-board-navy font-display font-bold text-sm flex items-center justify-center">
                    {i + 1}
                  </span>
                  <div>
                    <p className="font-medium text-board-navy text-sm">{step.title}</p>
                    <p className="text-board-navy/50 text-sm">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="text-center">
              <button onClick={() => setShowWizard(true)} className="btn-primary">
                Criar o primeiro evento
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {events.map((event) => {
              return (
                <div key={event.id} className="card-game p-6">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <Link
                        to={`/organizer/events/${event.id}`}
                        className="font-display text-lg font-semibold text-board-navy leading-tight hover:text-board-crimson transition-colors"
                      >
                        {event.title}
                      </Link>
                      <p className="text-board-navy/55 text-sm mt-1">
                        {new Date(event.date).toLocaleString('pt-BR', {
                          day: '2-digit',
                          month: 'long',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}{' '}
                        · {event.venueName}
                      </p>
                      <p className="text-board-navy/45 text-xs mt-1">
                        {formatMoney(Number(event.price), event.currency)} ·{' '}
                        {event.seatingType === 'numbered' ? 'lugares marcados' : 'pista'} ·{' '}
                        {event.capacity} lugares
                        {event.halfPriceEnabled && (
                          <> · meia {event.halfPriceQuota ? `(cota ${event.halfPriceQuota})` : 'liberada'}</>
                        )}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span
                        className={`px-2.5 py-1 rounded-full text-xs font-semibold ${EVENT_STATUS_CLASS[event.status]}`}
                      >
                        {EVENT_STATUS_LABEL[event.status]}
                      </span>

                      {event.status === 'draft' && (
                        <>
                          <button
                            onClick={() => putOnSale(event.id)}
                            disabled={busyId === event.id}
                            className="btn-gold text-sm py-1.5 px-3 disabled:opacity-50"
                          >
                            {busyId === event.id ? '...' : PUBLISH_ACTION_LABEL}
                          </button>
                          <button
                            onClick={() => cancelEvent(event.id, event.title, event.status)}
                            disabled={busyId === event.id}
                            className="text-board-navy/50 text-sm hover:text-board-crimson hover:underline disabled:opacity-50"
                          >
                            Descartar
                          </button>
                        </>
                      )}

                      {event.status === 'published' && (
                        <button
                          onClick={() => cancelEvent(event.id, event.title, event.status)}
                          disabled={busyId === event.id}
                          className="text-board-crimson text-sm hover:underline disabled:opacity-50"
                        >
                          Cancelar
                        </button>
                      )}
                    </div>
                  </div>

                  {/* As vendas moram na tela do evento, junto com o mapa de
                      ocupação — dois lugares mostrando os mesmos números é um
                      lugar a mais para eles discordarem (SPEC_CP17 RF-5). */}
                  <div className="mt-3 flex flex-wrap gap-4">
                    <Link
                      to={`/organizer/events/${event.id}`}
                      className="text-sm text-board-crimson font-medium hover:underline"
                    >
                      {event.status === 'draft' ? 'Conferir a casa →' : 'Ver vendas e ocupação →'}
                    </Link>

                    {/* Conferir o que o cliente enxerga é parte do trabalho —
                        e não dá para conferir uma vitrine que você não pode
                        abrir (SPEC_CP19 RF-4). */}
                    {event.status === 'published' && (
                      <Link
                        to={`/events/${event.id}`}
                        className="text-sm text-board-navy/50 hover:text-board-navy hover:underline"
                      >
                        Ver na vitrine
                      </Link>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showWizard && (
        <EventWizard
          onClose={() => setShowWizard(false)}
          onCreated={async (created) => {
            setShowWizard(false);
            setJustCreated(created);
            // Espera a lista voltar antes de fechar, para o evento já estar lá
            await refresh();
          }}
        />
      )}
    </div>
  );
}
