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
  Query,
  Req,
} from "@nestjs/common";
import { Pool } from "pg";
import { bodyObject, currentUser, Request } from "./auth";
import { validDate, ZONE } from "./availability";

function bookingId(id: string) {
  if (!/^[1-9]\d{0,8}$/.test(id))
    throw new BadRequestException("Identificador de cita inválido.");
  return Number(id);
}
@Controller("api")
export class AgendaController {
  constructor(@Inject("DB") private readonly db: Pool) {}

  @Post("bookings/:id/cancel")
  @HttpCode(200)
  async cancel(@Req() req: Request, @Param("id") id: string) {
    const user = await currentUser(this.db, req);
    const key = bookingId(id);
    // Una sola escritura decide estado, propietario y límite temporal.
    const result = await this.db.query(
      `UPDATE bookings SET status='cancelled'
      WHERE id=$1 AND account_id=$2 AND status='confirmed' AND starts_at>statement_timestamp()
      RETURNING id,status`,
      [key, user.id],
    );
    if (result.rowCount) return { booking: result.rows[0] };
    const own = await this.db.query(
      "SELECT 1 FROM bookings WHERE id=$1 AND account_id=$2",
      [key, user.id],
    );
    if (!own.rowCount) throw new NotFoundException("Cita no encontrada.");
    throw new ConflictException(
      "Solo puedes cancelar una cita confirmada antes de su inicio. Actualiza tus citas.",
    );
  }

  private async manager(req: Request) {
    const user = await currentUser(this.db, req);
    if (user.role !== "manager")
      throw new ForbiddenException(
        "Esta sección está disponible solo para el responsable.",
      );
    return user;
  }

  @Get("management/agenda")
  async agenda(
    @Req() req: Request,
    @Query("date") date: unknown,
    @Query("status") status: unknown,
  ) {
    await this.manager(req);
    if (!validDate(date))
      throw new BadRequestException(
        "Selecciona una fecha válida (AAAA-MM-DD).",
      );
    if (
      status !== undefined &&
      (!["confirmed", "cancelled", "attended", "missed"].includes(
        String(status),
      ) ||
        typeof status !== "string")
    )
      throw new BadRequestException("Estado de cita inválido.");
    const result = await this.db.query(
      `SELECT b.id,b.service_name AS "serviceName",b.starts_at AS "startsAt",b.ends_at AS "endsAt",b.status,
      a.name AS "clientName",(b.status='confirmed' AND b.ends_at<=statement_timestamp()) AS "canComplete"
      FROM bookings b JOIN accounts a ON a.id=b.account_id
      WHERE b.starts_at >= ($1::date::timestamp AT TIME ZONE $2)
      AND b.starts_at < (($1::date+1)::timestamp AT TIME ZONE $2)
      AND ($3::text IS NULL OR b.status=$3)
      ORDER BY b.starts_at,b.id`,
      [date, ZONE, status ?? null],
    );
    return { date, timeZone: ZONE, bookings: result.rows };
  }

  @Post("management/bookings/:id/outcome")
  @HttpCode(200)
  async outcome(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    await this.manager(req);
    const key = bookingId(id);
    const body = bodyObject(input);
    if (body.status !== "attended" && body.status !== "missed")
      throw new BadRequestException("Elige Atendida o No asistió.");
    const result = await this.db.query(
      `UPDATE bookings SET status=$2 WHERE id=$1 AND status='confirmed' AND ends_at<=statement_timestamp()
      RETURNING id,status`,
      [key, body.status],
    );
    if (result.rowCount) return { booking: result.rows[0] };
    const found = await this.db.query("SELECT 1 FROM bookings WHERE id=$1", [
      key,
    ]);
    if (!found.rowCount) throw new NotFoundException("Cita no encontrada.");
    throw new ConflictException(
      "Solo puedes registrar el resultado de una cita confirmada cuya hora de finalización ya pasó. Actualiza la agenda.",
    );
  }
}
