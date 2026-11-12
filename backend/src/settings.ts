import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { Pool, PoolClient } from "pg";
import { bodyObject, currentUser, Request } from "./auth";
import { validDate, ZONE } from "./availability";
// Toda reserva y cambio de configuración comparte este bloqueo transaccional.
export const SCHEDULE_LOCK = 22002;
function time(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
function id(value: string) {
  if (!/^[1-9]\d{0,8}$/.test(value))
    throw new BadRequestException("Identificador inválido.");
  return Number(value);
}
@Controller("api/management/settings")
export class SettingsController {
  constructor(@Inject("DB") private readonly db: Pool) {}
  private async manager(req: Request) {
    if ((await currentUser(this.db, req)).role !== "manager")
      throw new ForbiddenException(
        "Solo el responsable puede configurar la agenda.",
      );
  }
  private async write<T>(operation: (client: PoolClient) => Promise<T>) {
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [SCHEDULE_LOCK]);
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  @Get() async get(@Req() req: Request) {
    await this.manager(req);
    // Una instantánea coherente; no mezclar lecturas de dos configuraciones distintas.
    return this.write(async (client) => {
      const services = await client.query(
        'SELECT id,name,description,duration_minutes AS "durationMinutes",active FROM services ORDER BY id',
      );
      const hours = await client.query(
        "SELECT weekday,to_char(opens,'HH24:MI') AS opens,to_char(closes,'HH24:MI') AS closes FROM weekly_hours ORDER BY weekday,opens",
      );
      const blocks = await client.query(
        'SELECT id,starts_at AS "startsAt",ends_at AS "endsAt" FROM schedule_blocks WHERE ends_at>statement_timestamp() ORDER BY starts_at,id',
      );
      return {
        services: services.rows,
        hours: hours.rows,
        blocks: blocks.rows,
      };
    });
  }
  private service(input: unknown) {
    const b = bodyObject(input);
    if (
      typeof b.name !== "string" ||
      b.name.trim().length < 2 ||
      b.name.trim().length > 100 ||
      typeof b.description !== "string" ||
      b.description.trim().length < 2 ||
      b.description.trim().length > 400 ||
      !Number.isInteger(b.durationMinutes) ||
      Number(b.durationMinutes) < 15 ||
      Number(b.durationMinutes) > 240 ||
      typeof b.active !== "boolean"
    )
      throw new BadRequestException(
        "Completa nombre (2–100), descripción (2–400), duración entera (15–240 minutos) y estado.",
      );
    return {
      name: b.name.trim(),
      description: b.description.trim(),
      duration: Number(b.durationMinutes),
      active: b.active,
    };
  }
  @Post("services") async createService(
    @Req() req: Request,
    @Body() input: unknown,
  ) {
    await this.manager(req);
    const b = this.service(input);
    return this.write(async (c) => {
      const result = await c.query(
        "INSERT INTO services(name,description,duration_minutes,active) VALUES($1,$2,$3,$4) RETURNING id",
        [b.name, b.description, b.duration, b.active],
      );
      return { service: result.rows[0] };
    });
  }
  @Post("services/:id") @HttpCode(200) async updateService(
    @Req() req: Request,
    @Param("id") key: string,
    @Body() input: unknown,
  ) {
    await this.manager(req);
    const serviceId = id(key),
      b = this.service(input);
    return this.write(async (c) => {
      const result = await c.query(
        "UPDATE services SET name=$2,description=$3,duration_minutes=$4,active=$5 WHERE id=$1 RETURNING id",
        [serviceId, b.name, b.description, b.duration, b.active],
      );
      if (!result.rowCount)
        throw new NotFoundException("Servicio no encontrado.");
      return { service: result.rows[0] };
    });
  }
  @Post("hours/:weekday") @HttpCode(200) async hours(
    @Req() req: Request,
    @Param("weekday") day: string,
    @Body() input: unknown,
  ) {
    await this.manager(req);
    const body = bodyObject(input);
    if (
      !/^[0-6]$/.test(day) ||
      !Array.isArray(body.periods) ||
      body.periods.length > 8
    )
      throw new BadRequestException("Selecciona un día y hasta ocho franjas.");
    const periods = body.periods
      .map((value: unknown) => {
        const b = bodyObject(value);
        if (!time(b.opens) || !time(b.closes) || b.opens >= b.closes)
          throw new BadRequestException(
            "Cada franja debe comenzar antes de terminar (HH:mm), dentro del mismo día.",
          );
        return { opens: b.opens, closes: b.closes };
      })
      .sort((a, b) => a.opens.localeCompare(b.opens));
    for (let i = 1; i < periods.length; i++)
      if (periods[i].opens < periods[i - 1].closes)
        throw new BadRequestException(
          "Las franjas del día no pueden superponerse.",
        );
    return this.write(async (c) => {
      // Cambiar la apertura no altera los intervalos históricos; toda cita pendiente debe seguir cubierta.
      const bookings = await c.query(
        `SELECT to_char(starts_at AT TIME ZONE $2,'HH24:MI:SS') AS start,
     to_char(ends_at AT TIME ZONE $2,'HH24:MI:SS') AS finish,
     (starts_at AT TIME ZONE $2)::date=(ends_at AT TIME ZONE $2)::date AS "sameDay"
     FROM bookings WHERE status='confirmed' AND ends_at>statement_timestamp()
     AND extract(dow from starts_at AT TIME ZONE $2)=$1`,
        [Number(day), ZONE],
      );
      if (
        bookings.rows.some(
          (b) =>
            !b.sameDay ||
            !periods.some(
              (p) => b.start >= p.opens + ":00" && b.finish <= p.closes + ":00",
            ),
        )
      )
        throw new ConflictException(
          "El nuevo horario dejaría una cita confirmada fuera de atención. Conserva una franja que cubra las citas existentes.",
        );
      await c.query("DELETE FROM weekly_hours WHERE weekday=$1", [Number(day)]);
      for (const p of periods)
        await c.query(
          "INSERT INTO weekly_hours(weekday,opens,closes) VALUES($1,$2,$3)",
          [Number(day), p.opens, p.closes],
        );
      return { weekday: Number(day), periods };
    });
  }
  @Post("blocks") async block(@Req() req: Request, @Body() input: unknown) {
    await this.manager(req);
    const b = bodyObject(input);
    if (
      !validDate(b.date) ||
      !time(b.opens) ||
      !time(b.closes) ||
      b.opens >= b.closes
    )
      throw new BadRequestException(
        "Selecciona fecha y un intervalo válido dentro del mismo día.",
      );
    return this.write(async (c) => {
      const limits = await c.query(
        `SELECT ($1::date+$2::time) AT TIME ZONE $4 AS start,($1::date+$3::time) AT TIME ZONE $4 AS finish,
     ($1::date+$2::time) AT TIME ZONE $4>statement_timestamp() AND $1::date<=((statement_timestamp() AT TIME ZONE $4)::date+90) AS valid`,
        [b.date, b.opens, b.closes, ZONE],
      );
      const { start, finish, valid } = limits.rows[0];
      if (!valid)
        throw new BadRequestException(
          "El bloqueo debe comenzar en el futuro y dentro de los próximos 90 días.",
        );
      const conflict = await c.query(
        "SELECT 1 FROM bookings WHERE status='confirmed' AND starts_at<$2 AND ends_at>$1 LIMIT 1",
        [start, finish],
      );
      if (conflict.rowCount)
        throw new ConflictException(
          "El bloqueo se superpone con una cita confirmada. Las citas existentes se conservan.",
        );
      const duplicate = await c.query(
        "SELECT 1 FROM schedule_blocks WHERE starts_at<$2 AND ends_at>$1 LIMIT 1",
        [start, finish],
      );
      if (duplicate.rowCount)
        throw new ConflictException(
          "Ya existe un bloqueo que cubre parte de ese intervalo.",
        );
      const result = await c.query(
        "INSERT INTO schedule_blocks(starts_at,ends_at) VALUES($1,$2) RETURNING id",
        [start, finish],
      );
      return { block: result.rows[0] };
    });
  }
  @Post("blocks/:id/remove") @HttpCode(200) async remove(
    @Req() req: Request,
    @Param("id") key: string,
  ) {
    await this.manager(req);
    const blockId = id(key);
    return this.write(async (c) => {
      const result = await c.query(
        "DELETE FROM schedule_blocks WHERE id=$1 RETURNING id",
        [blockId],
      );
      if (!result.rowCount)
        throw new NotFoundException("Bloqueo no encontrado.");
      return { removed: true };
    });
  }
}
