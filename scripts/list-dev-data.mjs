import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function numberEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid number env var: ${name}`);
  }
  return n;
}

function asNumber(value) {
  return Number(value ?? 0);
}

function printTable(title, rows) {
  console.log(`\n=== ${title} ===`);
  if (rows.length === 0) {
    console.log("(sem registros)");
    return;
  }
  console.table(rows);
}

async function run() {
  const postgres = {
    host: required("POSTGRES_HOST"),
    port: numberEnv("POSTGRES_PORT", 5432),
    user: required("POSTGRES_USER"),
    password: required("POSTGRES_PASSWORD"),
    database: required("POSTGRES_DB")
  };

  const pool = new Pool(postgres);

  try {
    const counts = await pool.query(`
      SELECT 'users' AS tabela, COUNT(*)::text AS total FROM users
      UNION ALL SELECT 'event_categories', COUNT(*)::text FROM event_categories
      UNION ALL SELECT 'arenas', COUNT(*)::text FROM arenas
      UNION ALL SELECT 'arena_spaces', COUNT(*)::text FROM arena_spaces
      UNION ALL SELECT 'arena_slots', COUNT(*)::text FROM arena_slots
      UNION ALL SELECT 'reservations', COUNT(*)::text FROM reservations
      UNION ALL SELECT 'reservation_recurrences', COUNT(*)::text FROM reservation_recurrences
      UNION ALL SELECT 'reservation_occurrences', COUNT(*)::text FROM reservation_occurrences
      UNION ALL SELECT 'events', COUNT(*)::text FROM events
      UNION ALL SELECT 'event_participants', COUNT(*)::text FROM event_participants
      UNION ALL SELECT 'bookings', COUNT(*)::text FROM bookings
      UNION ALL SELECT 'payments', COUNT(*)::text FROM payments
      UNION ALL SELECT 'notifications', COUNT(*)::text FROM notifications
      UNION ALL SELECT 'audit_logs', COUNT(*)::text FROM audit_logs
      ORDER BY tabela
    `);

    const totalRecords = counts.rows.reduce((sum, row) => sum + asNumber(row.total), 0);

    console.log("\nSpole dev data check");
    console.log(`Database: ${postgres.database}@${postgres.host}:${postgres.port}`);
    console.log(`Total domain records: ${totalRecords}`);

    printTable(
      "Contagem por tabela",
      counts.rows.map((row) => ({ tabela: row.tabela, total: asNumber(row.total) }))
    );

    printTable(
      "Usuários seed (@spole.dev)",
      (
        await pool.query(`
          SELECT name, email::text, role::text, status::text
          FROM users
          WHERE email::text LIKE '%@spole.dev'
          ORDER BY
            CASE role::text WHEN 'admin' THEN 1 WHEN 'arena_owner' THEN 2 ELSE 3 END,
            email::text
        `)
      ).rows
    );

    printTable(
      "Categorias",
      (
        await pool.query(`
          SELECT name, slug::text, status::text
          FROM event_categories
          ORDER BY name
        `)
      ).rows
    );

    printTable(
      "Arenas e policies",
      (
        await pool.query(`
          SELECT
            a.name AS arena,
            a.slug::text,
            a.status::text,
            u.email::text AS owner_email,
            aa.city,
            p.allow_recurring,
            p.min_reservation_payment_percent AS min_payment_percent
          FROM arenas a
          INNER JOIN users u ON u.id = a.owner_id
          INNER JOIN arena_addresses aa ON aa.arena_id = a.id
          INNER JOIN arena_policies p ON p.arena_id = a.id
          ORDER BY a.name
        `)
      ).rows
    );

    printTable(
      "Slots",
      (
        await pool.query(`
          SELECT
            a.name AS arena,
            sp.name AS space,
            s.status::text,
            s.allows_recurring,
            to_char(s.start_at, 'YYYY-MM-DD HH24:MI') AS start_at,
            s.price::text,
            s.notes
          FROM arena_slots s
          INNER JOIN arena_spaces sp ON sp.id = s.space_id
          INNER JOIN arenas a ON a.id = sp.arena_id
          ORDER BY s.start_at, a.name, sp.name
        `)
      ).rows
    );

    printTable(
      "Reservations",
      (
        await pool.query(`
          SELECT
            u.email::text AS organizer_email,
            r.status::text,
            r.type::text,
            to_char(s.start_at, 'YYYY-MM-DD HH24:MI') AS slot_start,
            r.total_price::text,
            r.required_payment_amount::text,
            r.paid_amount::text
          FROM reservations r
          INNER JOIN users u ON u.id = r.organizer_id
          INNER JOIN arena_slots s ON s.id = r.slot_id
          ORDER BY s.start_at
        `)
      ).rows
    );

    printTable(
      "Reservation occurrences",
      (
        await pool.query(`
          SELECT
            u.email::text AS organizer_email,
            o.status::text,
            to_char(s.start_at, 'YYYY-MM-DD HH24:MI') AS slot_start,
            to_char(o.due_at, 'YYYY-MM-DD HH24:MI') AS due_at,
            CASE WHEN o.released_at IS NULL THEN NULL ELSE to_char(o.released_at, 'YYYY-MM-DD HH24:MI') END AS released_at
          FROM reservation_occurrences o
          INNER JOIN reservation_recurrences rr ON rr.id = o.recurrence_id
          INNER JOIN reservations r ON r.id = rr.reservation_id
          INNER JOIN users u ON u.id = r.organizer_id
          INNER JOIN arena_slots s ON s.id = o.slot_id
          ORDER BY s.start_at
        `)
      ).rows
    );

    printTable(
      "Eventos",
      (
        await pool.query(`
          SELECT
            e.title,
            e.type::text,
            e.visibility::text,
            e.status::text,
            e.source_type::text,
            c.name AS category,
            e.city,
            to_char(e.start_at, 'YYYY-MM-DD HH24:MI') AS start_at,
            e.capacity,
            COUNT(DISTINCT ep.id)::int AS confirmed_participants,
            COUNT(DISTINCT b.id) FILTER (WHERE b.status IN ('RESERVED', 'COMPLETED'))::int AS active_bookings
          FROM events e
          INNER JOIN event_categories c ON c.id = e.category_id
          LEFT JOIN event_participants ep ON ep.event_id = e.id
          LEFT JOIN bookings b ON b.event_id = e.id
          GROUP BY e.id, c.name
          ORDER BY e.start_at
        `)
      ).rows
    );

    printTable(
      "Bookings e payments de booking",
      (
        await pool.query(`
          SELECT
            e.title AS event_title,
            u.email::text AS user_email,
            b.status::text,
            to_char(b.expires_at, 'YYYY-MM-DD HH24:MI') AS expires_at,
            p.status::text AS payment_status
          FROM bookings b
          INNER JOIN events e ON e.id = b.event_id
          INNER JOIN users u ON u.id = b.user_id
          LEFT JOIN payments p ON p.booking_id = b.id
          ORDER BY e.title, u.email::text
        `)
      ).rows
    );

    printTable(
      "Payments por contexto",
      (
        await pool.query(`
          SELECT
            p.provider_reference,
            u.email::text AS user_email,
            CASE
              WHEN p.booking_id IS NOT NULL THEN 'booking'
              WHEN p.reservation_id IS NOT NULL THEN 'reservation'
              WHEN p.reservation_occurrence_id IS NOT NULL THEN 'reservation_occurrence'
              ELSE 'unknown'
            END AS context,
            p.status::text,
            p.gross_amount::text,
            CASE WHEN p.paid_at IS NULL THEN NULL ELSE to_char(p.paid_at, 'YYYY-MM-DD HH24:MI') END AS paid_at
          FROM payments p
          INNER JOIN users u ON u.id = p.user_id
          ORDER BY context, p.status::text, p.provider_reference
        `)
      ).rows
    );

    printTable(
      "Notifications",
      (
        await pool.query(`
          SELECT
            u.email::text AS user_email,
            n.type::text,
            n.title,
            (n.read_at IS NOT NULL) AS read
          FROM notifications n
          INNER JOIN users u ON u.id = n.user_id
          ORDER BY n.created_at DESC
        `)
      ).rows
    );

    printTable(
      "Audit logs",
      (
        await pool.query(`
          SELECT
            u.email::text AS actor_email,
            a.action,
            a.resource_type,
            a.reason
          FROM audit_logs a
          INNER JOIN users u ON u.id = a.actor_user_id
          ORDER BY a.created_at DESC
        `)
      ).rows
    );
  } finally {
    await pool.end();
  }
}

run().catch((err) => {
  console.error("[list-dev-data] Falha ao consultar dados:", err);
  process.exit(1);
});
