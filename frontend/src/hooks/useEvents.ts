import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Event, EventSearchParams, PaginatedResponse } from '../types';

/**
 * Fetch paginated events with filters from GET /events.
 */
export function useEvents(params: EventSearchParams = {}) {
  return useQuery({
    queryKey: ['events', params],
    queryFn: async () => {
      const searchParams = new URLSearchParams();
      if (params.keyword) searchParams.set('keyword', params.keyword);
      if (params.city) searchParams.set('city', params.city);
      if (params.dateFrom) searchParams.set('dateFrom', params.dateFrom);
      if (params.dateTo) searchParams.set('dateTo', params.dateTo);
      if (params.priceMin !== undefined) searchParams.set('priceMin', String(params.priceMin));
      if (params.priceMax !== undefined) searchParams.set('priceMax', String(params.priceMax));
      if (params.sortBy) searchParams.set('sortBy', params.sortBy);
      if (params.page) searchParams.set('page', String(params.page));
      if (params.pageSize) searchParams.set('pageSize', String(params.pageSize));
      if (params.lat !== undefined) searchParams.set('lat', String(params.lat));
      if (params.lng !== undefined) searchParams.set('lng', String(params.lng));
      if (params.radius !== undefined) searchParams.set('radius', String(params.radius));

      const qs = searchParams.toString();
      const path = qs ? `/events?${qs}` : '/events';
      const res = await api.get<PaginatedResponse<Event>>(path);
      return res.data;
    },
    staleTime: 1000 * 60 * 2, // 2 minutes
  });
}

/**
 * Fetch single event detail from GET /events/:id.
 */
export function useEventDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['event', id],
    queryFn: async () => {
      if (!id) throw new Error('No event ID');
      const res = await api.get<Event>(`/events/${id}`);
      return res.data;
    },
    enabled: !!id,
  });
}

/**
 * Fetch available seats for an event from GET /reservations/seats/:eventId.
 */
export function useAvailableSeats(eventId: string | undefined) {
  return useQuery({
    queryKey: ['seats', eventId],
    queryFn: async () => {
      if (!eventId) throw new Error('No event ID');
      const res = await api.get<import('../types').Seat[]>(`/reservations/seats/${eventId}`);
      return res.data;
    },
    enabled: !!eventId,
    refetchInterval: 30000, // Refetch every 30s as fallback
  });
}
