import type { AppDeps } from "../../app";
import type { AuthUser } from "../../types/auth";
import { countEventUsedSpots, expireStaleBookings } from "../bookings/service";
import { assertEventOrganizerOrAdmin } from "./organizer-access";

export async function getEventOperationsSummary(deps: AppDeps, eventId: string, auth: AuthUser) {
  const event = await assertEventOrganizerOrAdmin(deps.pool, eventId, auth);
  await expireStaleBookings(deps.pool, deps.redis, { eventId });

  const participantsRes = await deps.pool.query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM event_participants
      WHERE event_id = $1 AND status = 'CONFIRMED'
    `,
    [eventId]
  );
  const confirmedParticipants = Number(participantsRes.rows[0]?.count ?? 0);

  const bookingsRes = await deps.pool.query<{ status: string; count: string }>(
    `
      SELECT status::text, COUNT(*)::text AS count
      FROM bookings
      WHERE event_id = $1
      GROUP BY status
    `,
    [eventId]
  );
  const bookingCounts = {
    activeBookings: 0,
    completedBookings: 0,
    cancelledBookings: 0,
    expiredBookings: 0
  };
  for (const row of bookingsRes.rows) {
    const n = Number(row.count);
    if (row.status === "RESERVED") bookingCounts.activeBookings = n;
    else if (row.status === "COMPLETED") bookingCounts.completedBookings = n;
    else if (row.status === "CANCELLED") bookingCounts.cancelledBookings = n;
    else if (row.status === "EXPIRED") bookingCounts.expiredBookings = n;
  }

  const paymentsRes = await deps.pool.query<{
    paid_count: string;
    pending_count: string;
    gross_revenue: string;
    net_revenue: string;
  }>(
    `
      SELECT
        COUNT(*) FILTER (WHERE p.status = 'PAID')::text AS paid_count,
        COUNT(*) FILTER (WHERE p.status = 'PENDING')::text AS pending_count,
        COALESCE(SUM(p.gross_amount) FILTER (WHERE p.status = 'PAID'), 0)::text AS gross_revenue,
        COALESCE(SUM(p.net_amount) FILTER (WHERE p.status = 'PAID'), 0)::text AS net_revenue
      FROM payments p
      INNER JOIN bookings b ON b.id = p.booking_id
      WHERE b.event_id = $1
    `,
    [eventId]
  );
  const payRow = paymentsRes.rows[0];

  const usedSpots = await countEventUsedSpots(deps.pool, eventId);

  return {
    eventId,
    capacity: event.capacity,
    confirmedParticipants,
    activeBookings: bookingCounts.activeBookings,
    completedBookings: bookingCounts.completedBookings,
    cancelledBookings: bookingCounts.cancelledBookings,
    expiredBookings: bookingCounts.expiredBookings,
    paidPaymentsCount: Number(payRow?.paid_count ?? 0),
    pendingPaymentsCount: Number(payRow?.pending_count ?? 0),
    grossRevenue: Number(payRow?.gross_revenue ?? 0),
    netRevenue: Number(payRow?.net_revenue ?? 0),
    remainingSpots: Math.max(0, event.capacity - usedSpots)
  };
}
