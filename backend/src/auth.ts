import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpException,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { Pool } from "pg";
export interface Request {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
}
interface Response {
  setHeader(name: string, value: string): void;
}
const COOKIE = "agenda_session";
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const derive = (password: string, salt: string) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(
      password,
      salt,
      64,
      { N: 65536, r: 8, p: 1, maxmem: 128 * 1024 * 1024 },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
export function bodyObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new BadRequestException("Datos inválidos.");
  return value as Record<string, unknown>;
}
function credentials(value: unknown) {
  const body = bodyObject(value);
  if (
    typeof body.email !== "string" ||
    body.email.length > 254 ||
    !/^\S+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()) ||
    typeof body.password !== "string" ||
    body.password.length < 12 ||
    body.password.length > 128 ||
    Buffer.byteLength(body.password) > 256
  )
    throw new BadRequestException(
      "Introduce un correo válido y una contraseña de 12 a 128 caracteres.",
    );
  return { email: body.email.trim().toLowerCase(), password: body.password };
}
function token(req: Request) {
  const cookie = req.headers.cookie;
  return typeof cookie === "string"
    ? cookie
        .split(";")
        .map((x) => x.trim())
        .find((x) => x.startsWith(COOKIE + "="))
        ?.slice(COOKIE.length + 1)
    : undefined;
}
export async function currentUser(db: Pool, req: Request) {
  const value = token(req);
  if (!value || !/^[a-f0-9]{64}$/.test(value))
    throw new UnauthorizedException("Inicia sesión para continuar.");
  const result = await db.query(
    "SELECT a.id,a.name,a.email,a.role FROM accounts a JOIN sessions s ON s.account_id=a.id WHERE s.token_hash=$1 AND s.expires_at>now()",
    [digest(value)],
  );
  if (!result.rowCount)
    throw new UnauthorizedException(
      "Tu sesión terminó. Vuelve a iniciar sesión.",
    );
  return result.rows[0];
}
@Controller("api/auth")
export class AuthController {
  private attempts = new Map<string, { count: number; until: number }>();
  constructor(@Inject("DB") private readonly db: Pool) {}
  private throttle(req: Request) {
    const now = Date.now();
    for (const [key, value] of this.attempts)
      if (value.until <= now) this.attempts.delete(key);
    const key = req.ip ?? "local";
    let entry = this.attempts.get(key);
    if (!entry) {
      if (this.attempts.size >= 1000)
        throw new HttpException("Intenta más tarde.", 429);
      entry = { count: 0, until: now + 15 * 60 * 1000 };
      this.attempts.set(key, entry);
    }
    if (++entry.count > 20)
      throw new HttpException("Demasiados intentos. Espera 15 minutos.", 429);
  }
  private async session(id: number, res: Response) {
    const value = randomBytes(32).toString("hex");
    await this.db.query("DELETE FROM sessions WHERE expires_at<=now()");
    await this.db.query(
      "INSERT INTO sessions(token_hash,account_id,expires_at) VALUES($1,$2,now()+interval '12 hours')",
      [digest(value), id],
    );
    res.setHeader(
      "Set-Cookie",
      `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/api; Max-Age=43200${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
    );
  }
  @Post("register")
  async register(
    @Body() input: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.throttle(req);
    const { email, password } = credentials(input);
    const body = bodyObject(input);
    if (
      typeof body.name !== "string" ||
      body.name.trim().length < 2 ||
      body.name.trim().length > 80
    )
      throw new BadRequestException(
        "El nombre debe tener entre 2 y 80 caracteres.",
      );
    const salt = randomBytes(16).toString("hex");
    const hash = (await derive(password, salt)).toString("hex");
    let result;
    try {
      result = await this.db.query(
        "INSERT INTO accounts(name,email,password_hash) VALUES($1,$2,$3) RETURNING id,name,email,role",
        [body.name.trim(), email, `scrypt$${salt}$${hash}`],
      );
    } catch (e) {
      if ((e as { code?: string }).code === "23505")
        throw new ConflictException(
          "No se pudo crear la cuenta con ese correo. Intenta iniciar sesión.",
        );
      throw e;
    }
    await this.session(result.rows[0].id, res);
    return { user: result.rows[0] };
  }
  @Post("login")
  @HttpCode(200)
  async login(
    @Body() input: unknown,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    this.throttle(req);
    const { email, password } = credentials(input);
    const result = await this.db.query(
      "SELECT id,name,email,role,password_hash FROM accounts WHERE email=$1",
      [email],
    );
    const account = result.rows[0];
    const parts = (
      account?.password_hash ?? `scrypt$${"0".repeat(32)}$${"0".repeat(128)}`
    ).split("$");
    const actual = await derive(password, parts[1]);
    const expected = Buffer.from(parts[2], "hex");
    if (
      !account ||
      expected.length !== actual.length ||
      !timingSafeEqual(actual, expected)
    )
      throw new UnauthorizedException("Correo o contraseña incorrectos.");
    await this.session(account.id, res);
    const { password_hash, ...user } = account;
    return { user };
  }
  @Get("me") async me(@Req() req: Request) {
    return { user: await currentUser(this.db, req) };
  }
  @Post("logout")
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const value = token(req);
    if (value)
      await this.db.query("DELETE FROM sessions WHERE token_hash=$1", [
        digest(value),
      ]);
    res.setHeader(
      "Set-Cookie",
      `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/api; Max-Age=0${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
    );
  }
}
