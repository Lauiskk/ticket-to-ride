import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { parseCorsOrigins } from '../shared/config/cors';

/**
 * WebSocket gateway for real-time seat availability updates (Req 21.1-21.6).
 *
 * - Room-based scoping by event ID: event:{eventId}
 * - Updates never cross events (Req 21.6)
 * - Broadcasts within 500ms of state change (Req 21.2)
 * - Clients join via 'join_event' message, leave via 'leave_event'
 */
/*
  A origem do socket segue a mesma lista fechada do HTTP (SPEC_CP21).

  Estava `origin: '*'` com um comentário prometendo configurar "em produção"
  — promessa que ninguém cumpre, porque nada quebra enquanto está aberto.
  Com `credentials: true` junto, era pior que o padrão: qualquer site podia
  abrir uma conexão autenticada com a sessão de quem estivesse visitando.
  `parseCorsOrigins` é a mesma função que já decide isso para as rotas HTTP,
  então as duas portas não têm como divergir.
*/
@WebSocketGateway({
  namespace: '/seats',
  cors: {
    origin: parseCorsOrigins(process.env.CORS_ORIGIN || 'http://localhost:5173'),
    credentials: true,
  },
})
export class ReservationGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ReservationGateway.name);

  handleConnection(client: Socket): void {
    this.logger.debug(`Client connected: ${client.id}`);
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`Client disconnected: ${client.id}`);
  }

  /**
   * Client joins an event room to receive seat updates.
   */
  @SubscribeMessage('join_event')
  handleJoinEvent(client: Socket, eventId: string): void {
    const room = `event:${eventId}`;
    client.join(room);
    this.logger.debug(`Client ${client.id} joined room ${room}`);
  }

  /**
   * Client leaves an event room.
   */
  @SubscribeMessage('leave_event')
  handleLeaveEvent(client: Socket, eventId: string): void {
    const room = `event:${eventId}`;
    client.leave(room);
    this.logger.debug(`Client ${client.id} left room ${room}`);
  }

  /**
   * Broadcast seat status update to all clients in the event room.
   * Called by ReservationService when seats change status.
   */
  broadcastSeatUpdate(eventId: string, seatIds: string[], status: string): void {
    const room = `event:${eventId}`;
    this.server.to(room).emit('seat_status_update', {
      eventId,
      seats: seatIds.map((id) => ({ id, status })),
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Broadcast multiple seat updates at once (e.g., reservation expiration).
   */
  broadcastSeatsReleased(eventId: string, seatIds: string[]): void {
    this.broadcastSeatUpdate(eventId, seatIds, 'available');
  }

  broadcastSeatsReserved(eventId: string, seatIds: string[]): void {
    this.broadcastSeatUpdate(eventId, seatIds, 'reserved');
  }

  /**
   * A ticket has just been consumed at the gate (SPEC_CP18 RF-1).
   *
   * The room `event:{id}` is public — the seat map depends on that — so the
   * payload carries **only ids and a timestamp**. Anyone listening already knew
   * that seat was sold; learning it walked in tells them nothing new. Holder
   * name, document and seat label stay out of here on purpose (RNF-1).
   */
  broadcastTicketValidated(eventId: string, ticketId: string, validatedAt: Date): void {
    this.server.to(`event:${eventId}`).emit('ticket_validated', {
      eventId,
      ticketId,
      validatedAt: validatedAt.toISOString(),
    });
  }
}
