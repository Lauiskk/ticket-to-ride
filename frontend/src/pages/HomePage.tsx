import { motion } from 'framer-motion';
import { Parallax } from 'react-scroll-parallax';
import { Link } from 'react-router-dom';
import { GiTicket, GiMusicalNotes, GiFilmProjector, GiTheater } from 'react-icons/gi';
import { useAuth } from '../context/AuthContext';
import { useGeolocation } from '../hooks/useGeolocation';
import { useEvents } from '../hooks/useEvents';

export function HomePage() {
  const { user } = useAuth();
  const { lat, lng } = useGeolocation();

  const { data: nearbyData } = useEvents(
    lat && lng ? { lat, lng, radius: 50, pageSize: 6 } : undefined!
  );
  const nearbyEvents = lat && lng ? nearbyData?.data : undefined;

  return (
    <div className="overflow-hidden">
      {/* ─── Hero Section with Parallax ───────────────────────────────────── */}
      <section className="relative min-h-[90vh] flex items-center justify-center bg-board-navy overflow-hidden">
        {/* Parallax background layers — reduced speeds to avoid jank */}
        <Parallax speed={-8} className="absolute inset-0 will-change-transform">
          <div className="absolute inset-0 bg-gradient-to-b from-board-navy via-board-navy-light to-board-wood-dark opacity-90" />
        </Parallax>

        <Parallax speed={-5} className="absolute inset-0 will-change-transform">
          <div className="absolute top-20 left-10 w-32 h-32 bg-board-gold/10 rounded-full blur-3xl" />
          <div className="absolute bottom-20 right-20 w-48 h-48 bg-board-crimson/10 rounded-full blur-3xl" />
          <div className="absolute top-1/3 right-1/4 w-24 h-24 bg-board-emerald/10 rounded-full blur-2xl" />
        </Parallax>

        <Parallax speed={-3} className="absolute inset-0 flex items-center justify-center opacity-5 will-change-transform">
          <div className="grid grid-cols-6 gap-8 rotate-12 scale-150">
            {Array.from({ length: 24 }).map((_, i) => (
              <GiTicket key={i} className="text-board-gold text-4xl" />
            ))}
          </div>
        </Parallax>

        {/* Floating decorative elements */}
        <motion.div
          className="absolute top-20 right-20 text-board-gold/20 text-3xl z-10"
          animate={{ y: [0, -8, 0], rotate: [0, 5, 0] }}
          transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
        >
          <GiTicket />
        </motion.div>
        <motion.div
          className="absolute top-1/3 left-16 text-board-crimson/15 text-2xl z-10"
          animate={{ y: [0, -8, 0], rotate: [0, -5, 0] }}
          transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut', delay: 2 }}
        >
          <GiMusicalNotes />
        </motion.div>
        <motion.div
          className="absolute bottom-1/3 right-16 text-board-emerald/15 text-2xl z-10"
          animate={{ y: [0, -8, 0], rotate: [0, 3, 0] }}
          transition={{ duration: 9, repeat: Infinity, ease: 'easeInOut', delay: 4 }}
        >
          <GiTheater />
        </motion.div>
        <motion.div
          className="absolute top-2/3 left-1/4 text-board-gold/10 text-4xl z-10"
          animate={{ y: [0, -8, 0], rotate: [0, -3, 0] }}
          transition={{ duration: 11, repeat: Infinity, ease: 'easeInOut', delay: 1 }}
        >
          <GiFilmProjector />
        </motion.div>

        {/* Hero content */}
        <div className="relative z-10 text-center px-4 max-w-4xl mx-auto">
          <Parallax speed={3} className="will-change-transform">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
            >
              <h1 className="font-display text-5xl md:text-7xl font-bold text-board-parchment leading-tight mb-6">
                Sua próxima
                <span className="block text-board-gold">aventura começa aqui</span>
              </h1>
              <p className="text-board-parchment/70 text-lg md:text-xl font-body max-w-2xl mx-auto mb-10">
                Descubra eventos incríveis, garanta seu ingresso e viva experiências
                que vão além do ordinário. Shows, filmes, teatro — tudo em um só lugar.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                <Link to="/events" className="btn-primary text-lg px-8 py-4">
                  Explorar Eventos
                </Link>
                {!user && (
                  <Link to="/register" className="btn-gold text-lg px-8 py-4">
                    Criar Conta
                  </Link>
                )}
              </div>
            </motion.div>
          </Parallax>
        </div>

        {/* Bottom wave */}
        <div className="absolute bottom-0 left-0 right-0">
          <svg viewBox="0 0 1440 120" fill="none" className="w-full">
            <path d="M0,80 C360,120 1080,40 1440,80 V120 H0 Z" fill="#FFFBF0" />
          </svg>
        </div>
      </section>

      {/* ─── Eventos Perto de Você (Carousel) ────────────────────────────── */}
      {lat && lng && nearbyEvents && nearbyEvents.length > 0 && (
        <section className="py-12 px-4 bg-board-cream">
          <div className="max-w-7xl mx-auto">
            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="section-title mb-6"
            >
              📍 Eventos Perto de Você
            </motion.h2>
            <div className="flex gap-4 overflow-x-auto pb-4 scrollbar-hide">
              {nearbyEvents.map((event) => (
                <Link
                  to={`/events/${event.id}`}
                  key={event.id}
                  className="flex-shrink-0 w-72"
                >
                  <motion.div
                    className="card-game h-full p-5 hover:shadow-lg transition-shadow"
                    whileHover={{ scale: 1.02 }}
                    transition={{ type: 'spring', stiffness: 300 }}
                  >
                    <h3 className="font-display text-lg font-semibold text-board-navy mb-2 line-clamp-2">
                      {event.title}
                    </h3>
                    <p className="text-sm text-board-navy/60 mb-1">
                      {event.venueName}
                    </p>
                    <p className="text-sm text-board-navy/50 mb-3">
                      {event.venueCity}
                    </p>
                    <div className="flex items-center justify-between mt-auto">
                      <span className="text-xs text-board-navy/50">
                        {new Date(event.date).toLocaleDateString('pt-BR', {
                          day: '2-digit',
                          month: 'short',
                        })}
                      </span>
                      <span className="font-display text-sm font-bold text-board-gold">
                        {event.currency} {event.price.toFixed(2)}
                      </span>
                    </div>
                  </motion.div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ─── Categories Section ──────────────────────────────────────────── */}
      <section className="py-20 px-4 bg-board-cream">
        <div className="max-w-6xl mx-auto">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="section-title text-center mb-12"
          >
            O que você procura?
          </motion.h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              { icon: GiMusicalNotes, title: 'Shows & Festivais', desc: 'Rock, sertanejo, eletrônica e mais', color: 'board-crimson' },
              { icon: GiFilmProjector, title: 'Cinema', desc: 'Estreias, clássicos e sessões especiais', color: 'board-navy' },
              { icon: GiTheater, title: 'Teatro & Stand-up', desc: 'Comédias, dramas e espetáculos', color: 'board-emerald' },
            ].map((cat, i) => (
              <motion.div
                key={cat.title}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.15 }}
                whileHover={{ scale: 1.03, rotateY: 5 }}
                className="card-game p-8 text-center cursor-pointer group"
              >
                <div className={`inline-flex p-4 rounded-full bg-${cat.color}/10 mb-4 group-hover:bg-${cat.color}/20 transition-colors`}>
                  <cat.icon className={`text-4xl text-${cat.color}`} />
                </div>
                <h3 className="font-display text-xl font-semibold mb-2">{cat.title}</h3>
                <p className="text-board-navy/60 font-body">{cat.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Animated Stats Counter (replaces brown divider) ─────────────── */}
      <section className="py-16 bg-board-navy">
        <div className="max-w-4xl mx-auto grid grid-cols-3 gap-8 text-center px-4">
          {[
            { value: 15, label: 'Eventos', suffix: '+' },
            { value: 6, label: 'Cidades', suffix: '' },
            { value: 1000, label: 'Assentos', suffix: '+' },
          ].map((stat, i) => (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.15 }}
            >
              <motion.span
                className="font-display text-4xl md:text-5xl font-bold text-board-gold block"
                initial={{ opacity: 0, scale: 0.8 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.15 + 0.2, type: 'spring', stiffness: 200 }}
              >
                {stat.value}{stat.suffix}
              </motion.span>
              <p className="text-board-parchment/60 text-sm mt-1">{stat.label}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ─── How it Works ────────────────────────────────────────────────── */}
      <section className="py-20 px-4 bg-board-cream">
        <div className="max-w-6xl mx-auto">
          <motion.h2
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="section-title text-center mb-16"
          >
            Como funciona
          </motion.h2>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            {[
              { step: '1', title: 'Escolha', desc: 'Navegue pelos eventos e encontre o seu' },
              { step: '2', title: 'Reserve', desc: 'Selecione seu assento no mapa interativo' },
              { step: '3', title: 'Pague', desc: 'Checkout seguro com confirmação instantânea' },
              { step: '4', title: 'Entre', desc: 'Mostre o QR Code na portaria e aproveite' },
            ].map((item, i) => (
              <motion.div
                key={item.step}
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="text-center"
              >
                <div className="w-14 h-14 bg-board-gold rounded-full flex items-center justify-center mx-auto mb-4 shadow-md">
                  <span className="font-display text-xl font-bold text-board-navy">{item.step}</span>
                </div>
                <h3 className="font-display text-lg font-semibold mb-1">{item.title}</h3>
                <p className="text-board-navy/60 text-sm">{item.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CTA Section ────────────────────────────────────────────────── */}
      {!user && (
        <section className="py-24 bg-board-navy relative overflow-hidden">
          <div className="absolute inset-0">
            <div className="absolute top-0 left-1/4 w-64 h-64 bg-board-gold/5 rounded-full blur-3xl" />
            <div className="absolute bottom-0 right-1/3 w-48 h-48 bg-board-crimson/5 rounded-full blur-3xl" />
          </div>
          <div className="max-w-3xl mx-auto text-center relative z-10 px-4">
            <h2 className="font-display text-4xl md:text-5xl font-bold text-board-parchment mb-6">
              Pronto para a aventura?
            </h2>
            <p className="text-board-parchment/60 text-lg mb-10">
              Crie sua conta em segundos e comece a explorar.
            </p>
            <Link to="/register" className="btn-primary text-lg px-10 py-4">
              Começar Agora
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
