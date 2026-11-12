import "reflect-metadata";
import {
  Controller,
  Get,
  Header,
  Inject,
  Module,
  Param,
  Query,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { Pool } from "pg";
import { AuthController } from "./auth";
import { BookingsController } from "./bookings";
import { AgendaController } from "./agenda";
import { SettingsController } from "./settings";
import { available, ZONE } from "./availability";
export { validDate } from "./availability";
@Controller("api")
class CatalogController {
  constructor(@Inject("DB") private readonly db: Pool) {}
  @Get("services")
  @Header("Cache-Control", "no-store")
  async services() {
    const result = await this.db.query(
      'SELECT id,name,description,duration_minutes AS "durationMinutes" FROM services WHERE active ORDER BY id',
    );
    return { timeZone: ZONE, services: result.rows };
  }
  @Get("services/:id/availability")
  @Header("Cache-Control", "no-store")
  async availability(@Param("id") id: string, @Query("date") date: unknown) {
    const { serviceName, ...result } = await available(this.db, id, date);
    return result;
  }
}
export async function createApplication(pool: Pool) {
  @Module({
    controllers: [
      CatalogController,
      AuthController,
      BookingsController,
      AgendaController,
      SettingsController,
    ],
    providers: [{ provide: "DB", useValue: pool }],
  })
  class AppModule {}
  const app = await NestFactory.create(AppModule, {
    logger: ["error", "warn"],
  });
  // Sin CORS: el navegador no permite enviar este encabezado desde otro origen.
  app.use(
    (
      req: { method: string; headers: Record<string, string | undefined> },
      res: { status(n: number): any; setHeader(k: string, v: string): void },
      next: () => void,
    ) => {
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "no-store");
      if (
        !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
        req.headers["x-agenda-request"] !== "1"
      )
        return res.status(403).json({ message: "Solicitud no permitida." });
      next();
    },
  );
  return app;
}
