import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import type { Seat } from '../types';

/**
 * Live seat availability for one event (SPEC_CP10 RF-6).
 *
 * The backend already broadcast `seat_status_update` on the `/seats` namespace —
 * nothing on the frontend listened, so a seat taken by someone else only greyed
 * out on the next 30s poll. This closes that loop.
 *
 * We patch the cached seat list in place instead of refetching: the payload
 * already carries the new status, and refetching 500+ seats to learn that one
 * of them changed is wasteful. Returns `connected` so the UI can be honest
 * about whether it is showing live data.
 */

const WS_URL = (import.meta.env.VITE_WS_URL as string | undefined) ?? 'http://localhost:3000';

interface SeatStatusUpdate {
  eventId: string;
  seats: Array<{ id: string; status: Seat['status'] }>;
  timestamp: string;
}

export function useSeatSocket(eventId: string | undefined): { connected: boolean } {
  const queryClient = useQueryClient();
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    if (!eventId) return;

    const socket = io(`${WS_URL}/seats`, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join_event', eventId);
    });

    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));

    socket.on('seat_status_update', (update: SeatStatusUpdate) => {
      // Room scoping already guarantees this, but never trust the wire
      if (update.eventId !== eventId) return;

      const changed = new Map(update.seats.map((s) => [s.id, s.status]));

      queryClient.setQueryData<Seat[]>(['seats', eventId], (current) =>
        current?.map((seat) =>
          changed.has(seat.id) ? { ...seat, status: changed.get(seat.id)! } : seat,
        ),
      );
    });

    return () => {
      socket.emit('leave_event', eventId);
      socket.disconnect();
      socketRef.current = null;
      setConnected(false);
    };
  }, [eventId, queryClient]);

  return { connected };
}
