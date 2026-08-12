import { useState, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { GiTicket } from 'react-icons/gi';
import { useEvents } from '../hooks/useEvents';
import { useGeolocation } from '../hooks/useGeolocation';
import type { EventSearchParams } from '../types';

export function EventsPage() {
  const [filters, setFilters] = useState<EventSearchParams>({ page: 1, pageSize: 12 });
  const { data, isLoading, isError, refetch } = useEvents(filters);
  const { lat, lng } = useGeolocation();

  useEffect(() => {
    if (lat && lng) {
      // Use geo only for sorting (radius=0 means no filter, just sort by proximity)
      setFilters((prev) => ({ ...prev, lat, lng, radius: 0 }));
    }
  }, [lat, lng]);

  const updateFilter = useCallback((key: keyof EventSearchParams, value: string | number | undefined) => {
    setFilters((prev) => ({ ...prev, [key]: value || undefined, page: 1 }));
  }, []);

  const events = data?.data || [];
  const meta = data?.meta;

  return (
    <div className="min-h-screen bg-board-cream py-12 px-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-12">
          <h1 className="section-title mb-4">Eventos Disponíveis</h1>
          <p className="text-board-navy/60 text-lg">Encontre o evento perfeito para você</p>
          {lat && lng && (
            <p className="text-board-gold text-sm mt-2 flex items-center justify-center gap-1">
              📍 Mostrando eventos perto de você
            </p>
          )}
        </motion.div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4 mb-8 max-w-4xl mx-auto flex-wrap">
          <input
            type="text"
            value={filters.keyword || ''}
            onChange={(e) => updateFilter('keyword', e.target.value)}
            placeholder="Buscar eventos..."
            className="flex-1 min-w-[200px] px-4 py-3 rounded-lg border border-board-parchment-dark bg-white focus:outline-none focus:ring-2 focus:ring-board-gold/50"
          />
          <input
            type="text"
            value={filters.city || ''}
            onChange={(e) => updateFilter('city', e.target.value)}
            placeholder="Cidade..."
            className="px-4 py-3 rounded-lg border border-board-parchment-dark bg-white focus:outline-none focus:ring-2 focus:ring-board-gold/50 w-40"
          />
          <select
            value={filters.sortBy || ''}
            onChange={(e) => updateFilter('sortBy', e.target.value)}
            className="px-4 py-3 rounded-lg border border-board-parchment-dark bg-white focus:outline-none focus:ring-2 focus:ring-board-gold/50"
          >
            <option value="">Ordenar por</option>
            <option value="date_asc">Data (próximos)</option>
            <option value="date_desc">Data (distantes)</option>
            <option value="price_asc">Preço (menor)</option>
            <option value="price_desc">Preço (maior)</option>
          </select>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="card-game animate-pulse">
                <div className="h-48 bg-board-parchment-dark/30" />
                <div className="p-5 space-y-3">
                  <div className="h-5 bg-board-parchment-dark/30 rounded w-3/4" />
                  <div className="h-4 bg-board-parchment-dark/20 rounded w-1/2" />
                  <div className="h-4 bg-board-parchment-dark/20 rounded w-1/3" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="text-center py-16">
            <p className="text-board-crimson text-lg mb-4">Não foi possível carregar os eventos.</p>
            <button onClick={() => refetch()} className="btn-primary">Tentar novamente</button>
          </div>
        )}

        {/* Empty */}
        {!isLoading && !isError && events.length === 0 && (
          <div className="text-center py-16">
            <GiTicket className="text-6xl text-board-navy/20 mx-auto mb-4" />
            <p className="text-board-navy/50 text-lg">Nenhum evento encontrado com esses filtros.</p>
          </div>
        )}

        {/* Event Grid */}
        {!isLoading && !isError && events.length > 0 && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {events.map((event, i) => (
                <motion.div
                  key={event.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  whileHover={{ scale: 1.02, rotateY: 2 }}
                  className="card-game group"
                >
                  <Link to={`/events/${event.id}`}>
                    <div className="h-48 overflow-hidden relative bg-board-navy/10 flex items-center justify-center">
                      {event.externalSource ? (
                        <img
                          src={`https://picsum.photos/seed/${event.id}/400/250`}
                          alt={event.title}
                          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                        />
                      ) : (
                        <GiTicket className="text-5xl text-board-navy/20" />
                      )}
                      <div className="absolute top-3 right-3 bg-board-navy/80 text-board-gold px-2 py-1 rounded text-xs font-medium">
                        {event.seatingType === 'numbered' ? 'Numerado' : 'Pista'}
                      </div>
                    </div>
                    <div className="p-5">
                      <h3 className="font-display text-lg font-semibold text-board-navy mb-2 group-hover:text-board-crimson transition-colors">
                        {event.title}
                      </h3>
                      <p className="text-board-navy/60 text-sm mb-1">{event.venueName}{event.venueCity ? `, ${event.venueCity}` : ''}</p>
                      <p className="text-board-navy/50 text-sm mb-3">
                        {new Date(event.date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </p>
                      <div className="flex items-center justify-between">
                        <span className="font-display text-xl font-bold text-board-crimson">
                          R$ {Number(event.price).toFixed(2)}
                        </span>
                        {event.availableSeats !== undefined && (
                          <span className="flex items-center gap-1 text-board-gold text-sm font-medium">
                            <GiTicket /> {event.availableSeats} disp.
                          </span>
                        )}
                      </div>
                    </div>
                  </Link>
                </motion.div>
              ))}
            </div>

            {/* Pagination */}
            {meta && meta.totalPages > 1 && (
              <div className="flex justify-center gap-2 mt-10">
                {Array.from({ length: meta.totalPages }, (_, i) => i + 1).map((page) => (
                  <button
                    key={page}
                    onClick={() => setFilters((prev) => ({ ...prev, page }))}
                    className={`w-10 h-10 rounded-full font-medium transition-all ${
                      page === meta.page
                        ? 'bg-board-crimson text-white shadow-md'
                        : 'bg-board-parchment text-board-navy hover:bg-board-parchment-dark'
                    }`}
                  >
                    {page}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
