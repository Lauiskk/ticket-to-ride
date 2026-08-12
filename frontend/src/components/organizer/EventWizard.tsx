import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { api } from '../../lib/api';
import { formatMoney } from '../../lib/eventStatus';
import type { CatalogItem } from '../../types';

/**
 * Event creation wizard (SPEC_CP12 RF-1..RF-4, RF-8).
 *
 * Three deliberate changes from the old form:
 *
 * 1. Nothing advances while a required field is empty, and the message sits on
 *    the field — not as a red banner at the top that makes you hunt.
 * 2. The seating layout is chosen here. The backend always supported numbered
 *    sections and general-admission sectors; the form never asked, so every
 *    event created through the UI silently became generic standing room.
 * 3. Capacity is *derived* from the layout instead of typed. Before, you could
 *    save "capacity 100" next to 300 actual seats and nothing complained.
 */

type SeatingType = 'numbered' | 'general-admission';

interface Section {
  name: string;
  rows: number;
  seatsPerRow: number;
}

interface Sector {
  name: string;
  capacity: number;
}

interface Props {
  onCreated: () => void;
  onClose: () => void;
}

type Errors = Record<string, string>;

const STEPS = ['Base', 'Detalhes', 'Lugares e preço', 'Revisão'];

/**
 * Two tabs because they are two different questions, answered by two different
 * APIs: "which real shows exist" (Ticketmaster, which knows venues) and "what
 * is in cinemas right now" (TMDb `now_playing`, which knows the listings).
 * A single search box could not answer either well.
 */
type CatalogTab = 'shows' | 'now-playing';

const CLASSIFICATIONS = ['Music', 'Arts & Theatre', 'Sports', 'Film', 'Miscellaneous'];

const CLASSIFICATION_LABEL: Record<string, string> = {
  Music: 'Shows e música',
  'Arts & Theatre': 'Teatro e artes',
  Sports: 'Esportes',
  Film: 'Cinema',
  Miscellaneous: 'Outros',
};

/** Local datetime string for <input type="datetime-local"> min attribute. */
function nowLocalISO(): string {
  const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
}

export function EventWizard({ onCreated, onClose }: Props) {
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Errors>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  // Step 0 — external catalogue
  const [tab, setTab] = useState<CatalogTab>('shows');
  const [query, setQuery] = useState('');
  const [catalogCity, setCatalogCity] = useState('');
  const [classification, setClassification] = useState('');
  const [results, setResults] = useState<CatalogItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [source, setSource] = useState<{ id: string; name: string } | null>(null);
  const [venueLat, setVenueLat] = useState<number | null>(null);
  const [venueLng, setVenueLng] = useState<number | null>(null);

  // Step 1 — details
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState('');
  const [venueName, setVenueName] = useState('');
  const [venueAddress, setVenueAddress] = useState('');
  const [venueCity, setVenueCity] = useState('');

  // Step 2 — seating & price
  const [seatingType, setSeatingType] = useState<SeatingType>('numbered');
  const [sections, setSections] = useState<Section[]>([
    { name: 'Plateia', rows: 10, seatsPerRow: 12 },
  ]);
  const [sectors, setSectors] = useState<Sector[]>([{ name: 'Pista', capacity: 200 }]);
  const [price, setPrice] = useState<number | ''>('');
  const [halfPriceEnabled, setHalfPriceEnabled] = useState(true);
  const [halfPriceQuota, setHalfPriceQuota] = useState<number | ''>('');

  const capacity = useMemo(() => {
    if (seatingType === 'numbered') {
      return sections.reduce((sum, s) => sum + (s.rows || 0) * (s.seatsPerRow || 0), 0);
    }
    return sectors.reduce((sum, s) => sum + (s.capacity || 0), 0);
  }, [seatingType, sections, sectors]);

  /** 40% is the figure in Lei 12.933/2013 — offered as the default, not forced. */
  const suggestedQuota = Math.floor(capacity * 0.4);

  // ─── Validation ───────────────────────────────────────────────────────────

  const validateStep = (target: number): boolean => {
    const e: Errors = {};

    if (target >= 1) {
      if (!title.trim()) e.title = 'Dê um nome ao evento.';
      else if (title.trim().length < 3) e.title = 'Nome muito curto.';

      if (!description.trim()) e.description = 'Descreva o que o público vai ver.';
      else if (description.trim().length < 10) e.description = 'Descreva com um pouco mais de detalhe.';

      if (!date) e.date = 'Informe data e horário.';
      else if (new Date(date).getTime() <= Date.now())
        e.date = 'A data precisa ser no futuro.';

      if (!venueName.trim()) e.venueName = 'Informe o nome do local.';
      if (!venueAddress.trim()) e.venueAddress = 'Informe o endereço.';
      if (!venueCity.trim()) e.venueCity = 'Informe a cidade.';
    }

    if (target >= 2 && step >= 2) {
      if (seatingType === 'numbered') {
        sections.forEach((s, i) => {
          if (!s.name.trim()) e[`section-${i}-name`] = 'Nome do setor.';
          if (!s.rows || s.rows < 1) e[`section-${i}-rows`] = 'Mín. 1.';
          if (!s.seatsPerRow || s.seatsPerRow < 1) e[`section-${i}-seats`] = 'Mín. 1.';
        });
      } else {
        sectors.forEach((s, i) => {
          if (!s.name.trim()) e[`sector-${i}-name`] = 'Nome do setor.';
          if (!s.capacity || s.capacity < 1) e[`sector-${i}-capacity`] = 'Mín. 1.';
        });
      }
      if (capacity < 1) e.capacity = 'Configure pelo menos um lugar.';
      if (price === '' || Number(price) < 0) e.price = 'Informe o preço (0 para gratuito).';
      if (halfPriceEnabled && halfPriceQuota !== '' && Number(halfPriceQuota) > capacity)
        e.halfPriceQuota = 'A cota não pode passar da capacidade.';
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const goTo = (target: number) => {
    if (target > step && !validateStep(target)) return;
    setStep(target);
  };

  // ─── Catalogue ────────────────────────────────────────────────────────────

  const search = async (nextTab: CatalogTab = tab) => {
    // "Em cartaz" needs no query — that is the whole point of the tab
    if (nextTab === 'shows' && !query.trim() && !catalogCity && !classification) return;

    setSearching(true);
    setSearched(true);
    try {
      const params = new URLSearchParams();
      if (nextTab === 'now-playing') {
        params.set('source', 'now-playing');
      } else {
        params.set('source', 'ticketmaster');
        if (query.trim()) params.set('query', query.trim());
        if (catalogCity.trim()) params.set('city', catalogCity.trim());
        if (classification) params.set('classificationName', classification);
      }

      const res = await api.get<{ items: CatalogItem[] }>(`/catalog/search?${params}`);
      setResults(res.data.items || []);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  const switchTab = (next: CatalogTab) => {
    setTab(next);
    setResults([]);
    setSearched(false);
    if (next === 'now-playing') search(next);
  };

  /**
   * Carry over everything the API already knows so the organizer types as
   * little as possible. What it does NOT carry: the date for a film (TMDb gives
   * the theatrical release, not the session) and never price or capacity —
   * those belong to whoever is running the room.
   */
  const useCatalogItem = (item: CatalogItem) => {
    setTitle(item.name);
    setDescription(item.description || '');
    setImageUrl(item.image ?? null);
    setSource({ id: item.externalId, name: item.source });

    if (item.source === 'ticketmaster' && item.date) {
      const d = new Date(item.date);
      if (!Number.isNaN(d.getTime()) && d.getTime() > Date.now()) {
        setDate(new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
      }
    }

    if (item.venue) setVenueName(item.venue);
    if (item.venueAddress) setVenueAddress(item.venueAddress);
    if (item.venueCity) setVenueCity(item.venueCity);
    setVenueLat(item.venueLat ?? null);
    setVenueLng(item.venueLng ?? null);

    // A film session is numbered seating far more often than not
    if (item.source === 'tmdb') setSeatingType('numbered');

    setStep(1);
  };

  // ─── Submit ───────────────────────────────────────────────────────────────

  const submit = async () => {
    if (!validateStep(2)) return;
    setSubmitting(true);
    setSubmitError('');
    try {
      await api.post('/events', {
        title: title.trim(),
        description: description.trim(),
        date: new Date(date).toISOString(),
        venueName: venueName.trim(),
        venueAddress: venueAddress.trim(),
        venueCity: venueCity.trim(),
        ...(venueLat !== null ? { venueLat } : {}),
        ...(venueLng !== null ? { venueLng } : {}),
        ...(imageUrl ? { imageUrl } : {}),
        ...(source ? { externalId: source.id, externalSource: source.name } : {}),
        capacity,
        seatingType,
        price: Number(price),
        currency: 'BRL',
        halfPriceEnabled,
        halfPriceQuota: halfPriceEnabled && halfPriceQuota !== '' ? Number(halfPriceQuota) : null,
        ...(seatingType === 'numbered' ? { sections } : { sectors }),
      });
      onCreated();
    } catch (err: any) {
      setSubmitError(err.message || 'Não foi possível criar o evento.');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Field helpers ────────────────────────────────────────────────────────

  const field = (name: string) =>
    `w-full px-4 py-3 rounded-lg bg-white border transition-colors focus:outline-none focus:ring-2 ${
      errors[name]
        ? 'border-board-crimson focus:ring-board-crimson/30'
        : 'border-board-parchment-dark focus:ring-board-gold/40'
    }`;

  const Err = ({ name }: { name: string }) =>
    errors[name] ? (
      <p className="text-board-crimson text-xs mt-1">{errors[name]}</p>
    ) : null;

  const Label = ({ children, required }: { children: React.ReactNode; required?: boolean }) => (
    <label className="block text-sm font-medium text-board-navy mb-1">
      {children}
      {required && <span className="text-board-crimson ml-0.5">*</span>}
    </label>
  );

  return (
    <div className="fixed inset-0 bg-black/60 flex items-start md:items-center justify-center z-50 p-4 overflow-y-auto">
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="bg-board-cream rounded-card shadow-card-hover w-full max-w-2xl my-4"
      >
        {/* Header + progress */}
        <div className="sticky top-0 bg-board-cream rounded-t-card border-b border-board-parchment-dark px-6 pt-5 pb-4 z-10">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-display text-xl font-bold text-board-navy">Criar evento</h2>
            <button
              onClick={onClose}
              aria-label="Fechar"
              className="text-board-navy/40 hover:text-board-navy text-xl leading-none"
            >
              ✕
            </button>
          </div>

          <ol className="flex items-center gap-1">
            {STEPS.map((label, i) => (
              <li key={label} className="flex-1">
                <button
                  onClick={() => goTo(i)}
                  disabled={i > step}
                  className="w-full text-left group disabled:cursor-not-allowed"
                >
                  <div
                    className={`h-1 rounded-full transition-colors ${
                      i <= step ? 'bg-board-gold' : 'bg-board-parchment-dark'
                    }`}
                  />
                  <span
                    className={`text-[11px] mt-1 block ${
                      i <= step ? 'text-board-navy' : 'text-board-navy/40'
                    }`}
                  >
                    {label}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>

        <div className="px-6 py-6">
          {/* ─── Step 0: catalogue ─────────────────────────────────────── */}
          {step === 0 && (
            <div>
              {/* Two sources, two questions */}
              <div className="flex gap-1 p-1 bg-board-parchment-dark/40 rounded-lg mb-4">
                {(
                  [
                    { value: 'shows' as const, label: 'Shows e eventos' },
                    { value: 'now-playing' as const, label: 'Filmes em cartaz' },
                  ]
                ).map((t) => (
                  <button
                    key={t.value}
                    onClick={() => switchTab(t.value)}
                    className={`flex-1 py-2 rounded-md text-sm font-medium transition-colors ${
                      tab === t.value
                        ? 'bg-white text-board-navy shadow-sm'
                        : 'text-board-navy/50 hover:text-board-navy'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>

              {tab === 'shows' ? (
                <>
                  <p className="text-board-navy/60 mb-3 text-sm">
                    Eventos reais no Brasil, via Ticketmaster. O item escolhido preenche local,
                    endereço, cidade e coordenadas.
                  </p>
                  <div className="space-y-2 mb-4">
                    <div className="flex gap-2">
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && search()}
                        placeholder="Ex.: Coldplay, Rosalía, stand-up..."
                        className="flex-1 px-4 py-3 rounded-lg border border-board-parchment-dark bg-white focus:outline-none focus:ring-2 focus:ring-board-gold/40"
                      />
                      <button
                        onClick={() => search()}
                        disabled={searching}
                        className="btn-primary whitespace-nowrap"
                      >
                        {searching ? '...' : 'Buscar'}
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <input
                        value={catalogCity}
                        onChange={(e) => setCatalogCity(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && search()}
                        placeholder="Cidade (opcional)"
                        className="flex-1 px-3 py-2 rounded-lg border border-board-parchment-dark bg-white text-sm focus:outline-none focus:ring-2 focus:ring-board-gold/40"
                      />
                      <select
                        value={classification}
                        onChange={(e) => setClassification(e.target.value)}
                        className="flex-1 px-3 py-2 rounded-lg border border-board-parchment-dark bg-white text-sm focus:outline-none focus:ring-2 focus:ring-board-gold/40"
                      >
                        <option value="">Qualquer categoria</option>
                        {CLASSIFICATIONS.map((c) => (
                          <option key={c} value={c}>
                            {CLASSIFICATION_LABEL[c]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </>
              ) : (
                <p className="text-board-navy/60 mb-4 text-sm">
                  O que está passando nos cinemas brasileiros agora, via TMDb. A data da sessão é
                  você quem define — o catálogo só sabe a estreia.
                </p>
              )}

              <div className="space-y-2 max-h-80 overflow-y-auto">
                {searching && (
                  <div className="space-y-2">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="h-20 rounded-lg bg-board-parchment-dark/30 animate-pulse" />
                    ))}
                  </div>
                )}

                {!searching &&
                  results.map((item) => (
                    <button
                      key={`${item.source}-${item.externalId}`}
                      onClick={() => useCatalogItem(item)}
                      className="w-full text-left flex gap-3 p-3 border border-board-parchment-dark rounded-lg hover:border-board-gold hover:bg-board-parchment/40 transition-colors"
                    >
                      {item.image ? (
                        <img
                          src={item.image}
                          alt=""
                          loading="lazy"
                          className="w-14 h-20 object-cover rounded flex-shrink-0 bg-board-parchment-dark"
                        />
                      ) : (
                        <div className="w-14 h-20 rounded flex-shrink-0 bg-board-parchment-dark flex items-center justify-center text-board-navy/30 text-xs">
                          sem foto
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-board-navy leading-tight">{item.name}</p>
                        <p className="text-xs text-board-navy/50 mt-1">{item.category}</p>
                        {item.venue && (
                          <p className="text-xs text-board-navy/60 mt-0.5">
                            📍 {item.venue}
                            {item.venueCity ? ` · ${item.venueCity}` : ''}
                          </p>
                        )}
                        {item.date && (
                          <p className="text-xs text-board-navy/40 mt-0.5">
                            {item.source === 'tmdb' ? 'Estreia: ' : ''}
                            {new Date(item.date).toLocaleDateString('pt-BR')}
                          </p>
                        )}
                      </div>
                    </button>
                  ))}

                {searched && !searching && results.length === 0 && (
                  <p className="text-board-navy/40 text-sm text-center py-8">
                    Nada encontrado. Tente outro termo ou monte do zero.
                  </p>
                )}
              </div>

              <button
                onClick={() => setStep(1)}
                className="mt-5 text-board-crimson font-medium hover:underline"
              >
                Montar do zero →
              </button>
            </div>
          )}

          {/* ─── Step 1: details ───────────────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <Label required>Título</Label>
                <input value={title} onChange={(e) => setTitle(e.target.value)} className={field('title')} />
                <Err name="title" />
              </div>

              <div>
                <Label required>Descrição</Label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className={field('description')}
                />
                <Err name="description" />
              </div>

              <div>
                <Label required>Data e horário</Label>
                <input
                  type="datetime-local"
                  value={date}
                  min={nowLocalISO()}
                  onChange={(e) => setDate(e.target.value)}
                  className={field('date')}
                />
                <Err name="date" />
              </div>

              <div>
                <Label required>Local</Label>
                <input
                  value={venueName}
                  onChange={(e) => setVenueName(e.target.value)}
                  placeholder="Ex.: Teatro Municipal"
                  className={field('venueName')}
                />
                <Err name="venueName" />
              </div>

              <div>
                <Label required>Endereço</Label>
                <input
                  value={venueAddress}
                  onChange={(e) => setVenueAddress(e.target.value)}
                  placeholder="Rua, número, bairro"
                  className={field('venueAddress')}
                />
                <Err name="venueAddress" />
              </div>

              <div>
                <Label required>Cidade</Label>
                <input
                  value={venueCity}
                  onChange={(e) => setVenueCity(e.target.value)}
                  className={field('venueCity')}
                />
                <Err name="venueCity" />
              </div>
            </div>
          )}

          {/* ─── Step 2: seating & price ───────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-6">
              <div>
                <Label required>Como as pessoas ocupam o espaço?</Label>
                <div className="grid grid-cols-2 gap-3 mt-2">
                  {(
                    [
                      {
                        value: 'numbered' as const,
                        title: 'Lugares marcados',
                        hint: 'Teatro, cinema — cada pessoa escolhe a cadeira',
                      },
                      {
                        value: 'general-admission' as const,
                        title: 'Pista / área livre',
                        hint: 'Show, festival — vende-se quantidade',
                      },
                    ]
                  ).map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => setSeatingType(opt.value)}
                      className={`text-left p-4 rounded-lg border-2 transition-colors ${
                        seatingType === opt.value
                          ? 'border-board-gold bg-board-gold/10'
                          : 'border-board-parchment-dark hover:border-board-gold/50'
                      }`}
                    >
                      <p className="font-medium text-board-navy">{opt.title}</p>
                      <p className="text-xs text-board-navy/50 mt-1">{opt.hint}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Layout builder */}
              {seatingType === 'numbered' ? (
                <div className="space-y-3">
                  <Label required>Setores</Label>
                  {sections.map((s, i) => (
                    <div key={i} className="flex gap-2 items-start">
                      <div className="flex-1">
                        <input
                          value={s.name}
                          onChange={(e) =>
                            setSections(sections.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                          }
                          placeholder="Nome do setor"
                          className={field(`section-${i}-name`)}
                        />
                        <Err name={`section-${i}-name`} />
                      </div>
                      <div className="w-24">
                        <input
                          type="number"
                          min={1}
                          value={s.rows}
                          onChange={(e) =>
                            setSections(sections.map((x, j) => (j === i ? { ...x, rows: Number(e.target.value) } : x)))
                          }
                          className={field(`section-${i}-rows`)}
                        />
                        <p className="text-[11px] text-board-navy/40 mt-0.5">fileiras</p>
                      </div>
                      <div className="w-24">
                        <input
                          type="number"
                          min={1}
                          value={s.seatsPerRow}
                          onChange={(e) =>
                            setSections(
                              sections.map((x, j) => (j === i ? { ...x, seatsPerRow: Number(e.target.value) } : x)),
                            )
                          }
                          className={field(`section-${i}-seats`)}
                        />
                        <p className="text-[11px] text-board-navy/40 mt-0.5">por fileira</p>
                      </div>
                      {sections.length > 1 && (
                        <button
                          onClick={() => setSections(sections.filter((_, j) => j !== i))}
                          aria-label="Remover setor"
                          className="text-board-crimson/60 hover:text-board-crimson px-2 py-3"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    onClick={() => setSections([...sections, { name: '', rows: 5, seatsPerRow: 10 }])}
                    className="text-board-crimson text-sm font-medium hover:underline"
                  >
                    + Adicionar setor
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <Label required>Setores</Label>
                  {sectors.map((s, i) => (
                    <div key={i} className="flex gap-2 items-start">
                      <div className="flex-1">
                        <input
                          value={s.name}
                          onChange={(e) =>
                            setSectors(sectors.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                          }
                          placeholder="Ex.: Pista, Camarote"
                          className={field(`sector-${i}-name`)}
                        />
                        <Err name={`sector-${i}-name`} />
                      </div>
                      <div className="w-32">
                        <input
                          type="number"
                          min={1}
                          value={s.capacity}
                          onChange={(e) =>
                            setSectors(sectors.map((x, j) => (j === i ? { ...x, capacity: Number(e.target.value) } : x)))
                          }
                          className={field(`sector-${i}-capacity`)}
                        />
                        <p className="text-[11px] text-board-navy/40 mt-0.5">lugares</p>
                      </div>
                      {sectors.length > 1 && (
                        <button
                          onClick={() => setSectors(sectors.filter((_, j) => j !== i))}
                          aria-label="Remover setor"
                          className="text-board-crimson/60 hover:text-board-crimson px-2 py-3"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    onClick={() => setSectors([...sectors, { name: '', capacity: 100 }])}
                    className="text-board-crimson text-sm font-medium hover:underline"
                  >
                    + Adicionar setor
                  </button>
                </div>
              )}

              {/* Derived capacity — the number that will actually exist */}
              <div className="bg-board-navy text-board-parchment rounded-lg px-4 py-3 flex items-baseline justify-between">
                <span className="text-sm text-board-parchment/70">Capacidade total</span>
                <span className="font-display text-2xl font-bold text-board-gold">
                  {capacity.toLocaleString('pt-BR')}
                  <span className="text-sm font-normal text-board-parchment/50 ml-1">lugares</span>
                </span>
              </div>
              <Err name="capacity" />

              <div>
                <Label required>Preço inteiro</Label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={price}
                  onChange={(e) => setPrice(e.target.value === '' ? '' : Number(e.target.value))}
                  placeholder="0,00"
                  className={field('price')}
                />
                <Err name="price" />
              </div>

              {/* Half-price */}
              <div className="border border-board-parchment-dark rounded-lg p-4 bg-board-parchment/30">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={halfPriceEnabled}
                    onChange={(e) => setHalfPriceEnabled(e.target.checked)}
                    className="mt-1 w-4 h-4 accent-board-crimson"
                  />
                  <span>
                    <span className="font-medium text-board-navy">Oferecer meia-entrada</span>
                    <span className="block text-xs text-board-navy/50 mt-0.5">
                      A Lei 12.933/2013 exige 40% dos ingressos a meio preço para estudantes,
                      idosos e pessoas com deficiência. Desmarque apenas para eventos privados.
                    </span>
                  </span>
                </label>

                {halfPriceEnabled && (
                  <div className="mt-4 pl-7">
                    <Label>Cota de meias</Label>
                    <div className="flex gap-2 items-start">
                      <div className="w-40">
                        <input
                          type="number"
                          min={0}
                          value={halfPriceQuota}
                          onChange={(e) =>
                            setHalfPriceQuota(e.target.value === '' ? '' : Number(e.target.value))
                          }
                          placeholder="Sem limite"
                          className={field('halfPriceQuota')}
                        />
                        <Err name="halfPriceQuota" />
                      </div>
                      {suggestedQuota > 0 && (
                        <button
                          onClick={() => setHalfPriceQuota(suggestedQuota)}
                          className="px-3 py-3 text-sm text-board-crimson hover:underline whitespace-nowrap"
                        >
                          Usar 40% ({suggestedQuota})
                        </button>
                      )}
                    </div>
                    <p className="text-xs text-board-navy/40 mt-1">
                      Em branco = sem limite de meias.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ─── Step 3: review ────────────────────────────────────────── */}
          {step === 3 && (
            <div>
              <p className="text-board-navy/60 text-sm mb-4">
                Confira antes de criar. O evento nasce como <strong>Rascunho</strong> — só entra à
                venda quando você mandar.
              </p>

              <dl className="divide-y divide-board-parchment-dark border-y border-board-parchment-dark">
                {[
                  ['Título', title],
                  ['Quando', new Date(date).toLocaleString('pt-BR', { dateStyle: 'full', timeStyle: 'short' })],
                  ['Onde', `${venueName} — ${venueCity}`],
                  ['Endereço', venueAddress],
                  [
                    'Lugares',
                    `${capacity.toLocaleString('pt-BR')} · ${
                      seatingType === 'numbered' ? 'marcados' : 'pista'
                    }`,
                  ],
                  ['Preço inteiro', formatMoney(Number(price || 0))],
                  ['Meia-entrada', formatMoney(Number(price || 0) / 2)],
                  [
                    'Cota de meias',
                    halfPriceEnabled
                      ? halfPriceQuota === ''
                        ? 'Sem limite'
                        : `${halfPriceQuota} ingressos`
                      : 'Não oferece',
                  ],
                ].map(([label, value]) => (
                  <div key={label as string} className="py-2.5 flex gap-4 text-sm">
                    <dt className="w-36 flex-shrink-0 text-board-navy/50">{label}</dt>
                    <dd className="text-board-navy font-medium">{value}</dd>
                  </div>
                ))}
              </dl>

              {submitError && (
                <p className="text-board-crimson text-sm mt-4 bg-board-crimson/10 rounded p-3">
                  {submitError}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Footer nav */}
        <div className="border-t border-board-parchment-dark px-6 py-4 flex justify-between gap-3">
          <button
            onClick={() => (step === 0 ? onClose() : setStep(step - 1))}
            className="px-5 py-2.5 text-board-navy/60 hover:text-board-navy font-medium"
          >
            {step === 0 ? 'Cancelar' : '← Voltar'}
          </button>

          {step < 3 ? (
            <button onClick={() => goTo(step + 1)} className="btn-primary">
              Continuar →
            </button>
          ) : (
            <button onClick={submit} disabled={submitting} className="btn-primary disabled:opacity-50">
              {submitting ? 'Criando...' : 'Criar evento'}
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}
