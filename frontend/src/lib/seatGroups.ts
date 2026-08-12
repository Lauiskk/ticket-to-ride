import type { Seat } from '../types';

/**
 * Seats arranged the way a venue is: section → row → seats, left to right.
 *
 * Shared by the buyer's `SeatMap` and the organizer's `OccupancyMap` so the two
 * always draw the same house. A general-admission event has no rows, so its
 * seats collapse into a single `GA` row per sector.
 */
export function groupSeats(seats: Seat[]): Map<string, Map<string, Seat[]>> {
  const bySection = new Map<string, Map<string, Seat[]>>();

  for (const seat of seats) {
    if (!bySection.has(seat.section)) bySection.set(seat.section, new Map());
    const rows = bySection.get(seat.section)!;
    const rowKey = seat.row || 'GA';
    if (!rows.has(rowKey)) rows.set(rowKey, []);
    rows.get(rowKey)!.push(seat);
  }

  for (const rows of bySection.values()) {
    for (const [key, rowSeats] of rows.entries()) {
      rows.set(
        key,
        rowSeats.sort((a, b) => Number(a.number || 0) - Number(b.number || 0)),
      );
    }
  }

  return bySection;
}
