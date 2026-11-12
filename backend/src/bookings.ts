import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  Post,
  Req,
} from "@nestjs/common";
import { Pool } from "pg";
import { bodyObject, currentUser, Request } from "./auth";
import { available } from "./availability";
import { SCHEDULE_LOCK } from "./settings";
@Controller("api/bookings")
export class BookingsController {
  constructor(@Inject("DB") private readonly db: Pool) {}
  @Get() async mine(@Req() req: Request) {
    const user = await currentUser(this.db, req);
    const result = await this.db.query(
      `SELECT id,service_name AS "serviceName",starts_at AS "startsAt",ends_at AS "endsAt",status,
       (status='confirmed' AND starts_at>statement_timestamp()) AS "canCancel"
       FROM bookings WHERE account_id=$1 ORDER BY starts_at DESC`,
      [user.id],
    );
    return { bookings: result.rows };
  }
  @Post() async create(@Req() req: Request, @Body() input: unknown) {
    const user = await currentUser(this.db, req);
    const body = bodyObject(input);
    if (
      !Number.isSafeInteger(body.serviceId) ||
      Number(body.serviceId) <= 0 ||
      typeof body.startsAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00(?:\.000)?Z$/.test(body.startsAt)
    )
      throw new BadRequestException(
        "Selecciona un servicio y horario de la agenda.",
      );
    const start = new Date(body.startsAt);
    if (
      !Number.isFinite(start.getTime()) ||
      start.toISOString().replace(".000Z", "Z") !==
        body.startsAt.replace(".000Z", "Z")
    )
      throw new BadRequestException("Horario inválido.");
    const localDate = new Date(start.getTime() - 4 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const client = await this.db.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock($1)", [SCHEDULE_LOCK]);
      const options = await available(
        client,
        String(body.serviceId),
        localDate,
      );
      const slot = options.slots.find(
        (s) => s.startsAt.getTime() === start.getTime(),
      );
      if (!slot)
        throw new ConflictException(
          "Ese horario ya no está disponible. Consulta la agenda nuevamente.",
        );
      const result = await client.query(
        `INSERT INTO bookings(account_id,service_id,service_name,starts_at,ends_at) VALUES($1,$2,$3,$4,$5)
    RETURNING id,service_name AS "serviceName",starts_at AS "startsAt",ends_at AS "endsAt",status`,
        [
          user.id,
          body.serviceId,
          options.serviceName,
          slot.startsAt,
          slot.endsAt,
        ],
      );
      await client.query("COMMIT");
      return { booking: result.rows[0] };
    } catch (e) {
      await client.query("ROLLBACK");
      if ((e as { code?: string }).code === "23P01")
        throw new ConflictException(
          "Otra persona acaba de reservar ese horario. Elige otro disponible.",
        );
      throw e;
    } finally {
      client.release();
    }
  }
}
