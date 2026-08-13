import { useEffect, useMemo, useState } from 'react';
import { io } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import type { Ticket } from '../types';

/**
 * Live ticket status for the person holding it (SPEC_CP18 RF-2).
 *
 * The gate marks a ticket as used in the database, but the buyer standing right
 * there — screen open, QR up — kept reading **"Válido"** until they reloaded.
 * The one moment a ticket changes state is the one moment the screen was stale.
 *
 * Reuses the `/seats` namespace and its event rooms: the connection already
 * exists in the app, and the gate broadcasts into `event:{id}`. The payload
 * carries only ids and a timestamp, so nothing here is trusted for authorisation
 * — it patches the cached status and lets the next authenticated read confirm.
 */

const WS_URL = (import.meta.env.VITE_WS_URL as string | undefined) ?? 'http://localhost:3000';

interface TicketValidated {
  eventId: string;
  ticketId: string;
  validatedAt: string;
}

export function useTicketSocket(eventIds: (string | undefined)[]): { connected: boolean } {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);

  // A ticket list re-renders constantly; without a stable key the socket would
  // tear down and reconnect on every one of those renders.
  const roomKey = useMemo(
    () => Array.from(new Set(eventIds.filter(Boolean) as string[])).sort().join(','),
    [eventIds],
  );

  useEffect(() => {
    if (!roomKey) return;
    const rooms = roomKey.split(',');

    const socket = io(`${WS_URL}/seats`, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      withCredentials: true,
    });

    socket.on('connect', () => {
      setConnected(true);
      // Re-join on every connect, not just the first: after a reconnection the
      // server has no memory of which rooms this socket was in.
      rooms.forEach((eventId) => socket.emit('join_event', eventId));
    });

    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));

    socket.on('ticket_validated', ({ ticketId, validatedAt }: TicketValidated) => {
      const markUsed = (ticket: Ticket): Ticket =>
        ticket.id === ticketId ? { ...ticket, status: 'used', validatedAt } : ticket;

      // A chave da lista termina com o id do dono (SPEC_CP24 RF-3); casar por
      // prefixo alcança a lista de quem estiver logado sem precisar sabê-lo.
      queryClient.setQueriesData<Ticket[]>({ queryKey: ['my-tickets'] }, (current) =>
        current?.map(markUsed),
      );
      queryClient.setQueryData<Ticket>(['ticket', ticketId], (current) =>
        current ? markUsed(current) : current,
      );
    });

    return () => {
      rooms.forEach((eventId) => socket.emit('leave_event', eventId));
      socket.disconnect();
      setConnected(false);
    };
  }, [roomKey, queryClient]);

  return { connected };
}
