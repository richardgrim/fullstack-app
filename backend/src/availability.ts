import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Pool, PoolClient } from "pg";
export const ZONE = "America/La_Paz";
export function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const d = new Date(value + "T00:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
export async function available(
  db: Pool | PoolClient,
  id: string,
  date: unknown,
) {
  if (!/^[1-9]\d{0,8}$/.test(id) || !validDate(date))
    throw new BadRequestException(
      "Selecciona un servicio y una fecha válida (AAAA-MM-DD).",
    );
  const bounds = await db.query(
    "SELECT (statement_timestamp() AT TIME ZONE $1)::date::text AS today, ((statement_timestamp() AT TIME ZONE $1)::date+90)::text AS last",
    [ZONE],
  );
  if (date < bounds.rows[0].today || date > bounds.rows[0].last)
    throw new BadRequestException(
      "Consulta una fecha entre hoy y los próximos 90 días.",
    );
  const service = await db.query(
    "SELECT name,duration_minutes FROM services WHERE id=$1 AND active",
    [Number(id)],
  );
  if (!service.rowCount) throw new NotFoundException("Servicio no encontrado.");
  const duration = service.rows[0].duration_minutes;
  const slots = await db.query(
    `
 SELECT DISTINCT slot AS "startsAt", slot + make_interval(mins => $2) AS "endsAt"
 FROM weekly_hours h CROSS JOIN LATERAL generate_series(
 ($1::date+h.opens) AT TIME ZONE $3,
 (($1::date+h.closes) AT TIME ZONE $3)-make_interval(mins => $2),interval '15 minutes') slot
 WHERE h.weekday=extract(dow FROM $1::date) AND slot>statement_timestamp()
 AND NOT EXISTS(SELECT 1 FROM schedule_blocks b WHERE b.starts_at<slot+make_interval(mins => $2) AND b.ends_at>slot)
 AND NOT EXISTS(SELECT 1 FROM bookings b WHERE b.status<>'cancelled' AND b.starts_at<slot+make_interval(mins => $2) AND b.ends_at>slot)
 ORDER BY "startsAt"`,
    [date, duration, ZONE],
  );
  return {
    date,
    timeZone: ZONE,
    durationMinutes: duration,
    slots: slots.rows,
    serviceName: service.rows[0].name,
  };
}
