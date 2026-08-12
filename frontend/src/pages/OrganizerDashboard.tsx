import { useState } from 'react';
import { motion } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { GiDiceSixFacesTwo } from 'react-icons/gi';
import { api } from '../lib/api';
import type { Event, CatalogItem } from '../types';

export function OrganizerDashboard() {
  const queryClient = useQueryClient();
  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogResults, setCatalogResults] = useState<CatalogItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [formData, setFormData] = useState({
    title: '', description: '', date: '', venueName: '', venueAddress: '',
    venueCity: '', capacity: 100, seatingType: 'general-admission' as string,
    price: 50, currency: 'BRL',
  });
  const [submitting, setSubmitting] = useState(false);

  const { data: events, isLoading } = useQuery({
    queryKey: ['my-events'],
    queryFn: async () => {
      const res = await api.get<Event[]>('/events/my/list');
      return res.data;
    },
  });

  const searchCatalog = async () => {
    if (!catalogQuery.trim()) return;
    setSearching(true);
    try {
      const res = await api.get<{ items: CatalogItem[] }>(`/catalog/search?query=${encodeURIComponent(catalogQuery)}`);
      setCatalogResults(res.data.items || []);
    } catch { setCatalogResults([]); }
    finally { setSearching(false); }
  };

  const selectCatalogItem = (item: CatalogItem) => {
    setFormData((prev) => ({ ...prev, title: item.name, description: item.description || '' }));
    setWizardStep(2);
  };

  const handlePublish = async (eventId: string) => {
    try {
      await api.patch(`/events/${eventId}/publish`);
      queryClient.invalidateQueries({ queryKey: ['my-events'] });
    } catch { /* toast */ }
  };

  const handleCancel = async (eventId: string) => {
    if (!confirm('Tem certeza que deseja cancelar este evento?')) return;
    try {
      await api.patch(`/events/${eventId}/cancel`);
      queryClient.invalidateQueries({ queryKey: ['my-events'] });
    } catch { /* toast */ }
  };

  const handleCreateEvent = async () => {
    setSubmitting(true);
    try {
      await api.post('/events', formData);
      queryClient.invalidateQueries({ queryKey: ['my-events'] });
      setShowWizard(false);
      setWizardStep(1);
      setFormData({ title: '', description: '', date: '', venueName: '', venueAddress: '', venueCity: '', capacity: 100, seatingType: 'general-admission', price: 50, currency: 'BRL' });
    } catch { /* toast */ }
    finally { setSubmitting(false); }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'published': return 'bg-board-emerald/20 text-board-emerald';
      case 'draft': return 'bg-board-gold/20 text-board-navy';
      case 'cancelled': return 'bg-board-crimson/20 text-board-crimson';
      default: return '';
    }
  };

  return (
    <div className="min-h-screen bg-board-cream py-12 px-4">
      <div className="max-w-6xl mx-auto">
        <motion.h1 initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="section-title mb-8 flex items-center gap-3">
          <GiDiceSixFacesTwo className="text-board-gold" /> Painel do Organizador
        </motion.h1>

        {/* Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="card-game p-6 text-center">
            <p className="text-board-navy/60 text-sm">Eventos Ativos</p>
            <p className="font-display text-3xl font-bold text-board-navy mt-1">
              {events?.filter((e) => e.status === 'published').length || 0}
            </p>
          </div>
          <div className="card-game p-6 text-center">
            <p className="text-board-navy/60 text-sm">Rascunhos</p>
            <p className="font-display text-3xl font-bold text-board-navy mt-1">
              {events?.filter((e) => e.status === 'draft').length || 0}
            </p>
          </div>
          <div className="card-game p-6 text-center">
            <p className="text-board-navy/60 text-sm">Total de Eventos</p>
            <p className="font-display text-3xl font-bold text-board-navy mt-1">{events?.length || 0}</p>
          </div>
        </div>

        {/* Create button */}
        <button onClick={() => setShowWizard(true)} className="btn-primary mb-8">+ Criar Novo Evento</button>

        {/* Events list */}
        {isLoading ? (
          <div className="space-y-4">
            {[1,2,3].map((i) => <div key={i} className="card-game p-6 animate-pulse h-24" />)}
          </div>
        ) : (
          <div className="space-y-4">
            {events?.map((event) => (
              <div key={event.id} className="card-game p-6 flex items-center justify-between">
                <div>
                  <h3 className="font-display text-lg font-semibold text-board-navy">{event.title}</h3>
                  <p className="text-board-navy/60 text-sm">{new Date(event.date).toLocaleDateString('pt-BR')} • {event.venueName}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusColor(event.status)}`}>{event.status}</span>
                  {event.status === 'draft' && <button onClick={() => handlePublish(event.id)} className="btn-gold text-sm py-1 px-3">Publicar</button>}
                  {event.status === 'published' && <button onClick={() => handleCancel(event.id)} className="text-board-crimson text-sm hover:underline">Cancelar</button>}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Wizard Modal */}
        {showWizard && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="bg-board-cream rounded-card shadow-card-hover max-w-lg w-full max-h-[90vh] overflow-y-auto p-8">
              <div className="flex justify-between items-center mb-6">
                <h2 className="font-display text-xl font-bold text-board-navy">Criar Evento — Passo {wizardStep}/3</h2>
                <button onClick={() => setShowWizard(false)} className="text-board-navy/40 hover:text-board-navy text-xl">✕</button>
              </div>

              {wizardStep === 1 && (
                <div>
                  <p className="text-board-navy/60 mb-4">Busque no catálogo ou pule para criar manualmente.</p>
                  <div className="flex gap-2 mb-4">
                    <input value={catalogQuery} onChange={(e) => setCatalogQuery(e.target.value)} placeholder="Buscar shows ou filmes..." className="flex-1 px-4 py-3 rounded-lg border border-board-parchment-dark bg-white" />
                    <button onClick={searchCatalog} disabled={searching} className="btn-primary">{searching ? '...' : 'Buscar'}</button>
                  </div>
                  {catalogResults.map((item) => (
                    <div key={item.externalId} onClick={() => selectCatalogItem(item)} className="p-3 border border-board-parchment-dark rounded-lg mb-2 cursor-pointer hover:bg-board-parchment-dark/20">
                      <p className="font-medium">{item.name}</p>
                      <p className="text-sm text-board-navy/50">{item.category}</p>
                    </div>
                  ))}
                  <button onClick={() => setWizardStep(2)} className="mt-4 text-board-crimson font-medium hover:underline">Pular e criar manualmente →</button>
                </div>
              )}

              {wizardStep === 2 && (
                <div className="space-y-4">
                  <input value={formData.title} onChange={(e) => setFormData((p) => ({ ...p, title: e.target.value }))} placeholder="Título" className="w-full px-4 py-3 rounded-lg border border-board-parchment-dark bg-white" />
                  <textarea value={formData.description} onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))} placeholder="Descrição" rows={3} className="w-full px-4 py-3 rounded-lg border border-board-parchment-dark bg-white" />
                  <input type="datetime-local" value={formData.date} onChange={(e) => setFormData((p) => ({ ...p, date: e.target.value }))} className="w-full px-4 py-3 rounded-lg border border-board-parchment-dark bg-white" />
                  <input value={formData.venueName} onChange={(e) => setFormData((p) => ({ ...p, venueName: e.target.value }))} placeholder="Nome do local" className="w-full px-4 py-3 rounded-lg border border-board-parchment-dark bg-white" />
                  <input value={formData.venueAddress} onChange={(e) => setFormData((p) => ({ ...p, venueAddress: e.target.value }))} placeholder="Endereço" className="w-full px-4 py-3 rounded-lg border border-board-parchment-dark bg-white" />
                  <input value={formData.venueCity} onChange={(e) => setFormData((p) => ({ ...p, venueCity: e.target.value }))} placeholder="Cidade" className="w-full px-4 py-3 rounded-lg border border-board-parchment-dark bg-white" />
                  <div className="flex gap-4">
                    <input type="number" value={formData.capacity} onChange={(e) => setFormData((p) => ({ ...p, capacity: Number(e.target.value) }))} placeholder="Capacidade" className="flex-1 px-4 py-3 rounded-lg border border-board-parchment-dark bg-white" />
                    <input type="number" value={formData.price} onChange={(e) => setFormData((p) => ({ ...p, price: Number(e.target.value) }))} placeholder="Preço" className="flex-1 px-4 py-3 rounded-lg border border-board-parchment-dark bg-white" />
                  </div>
                  <button onClick={() => setWizardStep(3)} className="btn-primary w-full">Revisar →</button>
                </div>
              )}

              {wizardStep === 3 && (
                <div>
                  <h3 className="font-display text-lg font-semibold mb-4">Revisão</h3>
                  <div className="space-y-2 text-sm text-board-navy/70 mb-6">
                    <p><strong>Título:</strong> {formData.title}</p>
                    <p><strong>Data:</strong> {formData.date}</p>
                    <p><strong>Local:</strong> {formData.venueName}, {formData.venueCity}</p>
                    <p><strong>Capacidade:</strong> {formData.capacity}</p>
                    <p><strong>Preço:</strong> R$ {formData.price}</p>
                  </div>
                  <button onClick={handleCreateEvent} disabled={submitting} className="btn-primary w-full">{submitting ? 'Criando...' : 'Criar Evento'}</button>
                  <button onClick={() => setWizardStep(2)} className="w-full mt-2 text-board-navy/50 text-sm hover:underline">← Voltar</button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </div>
    </div>
  );
}
