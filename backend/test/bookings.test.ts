import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { createApplication } from "../src/app";
import { database } from "../src/database";
const schema = "test_bookings_" + Date.now();
let admin: Pool;
let pool: Pool;
let app: Awaited<ReturnType<typeof createApplication>>;
let url: string;
let day: string;
let alice: string;
let bob: string;
let ownerId: number;
const password = "Solo-Pruebas-2026!";
async function post(path: string, body: unknown, cookie?: string) {
  return fetch(url + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Agenda-Request": "1",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}
async function get(path: string, cookie?: string) {
  return fetch(url + path, { headers: cookie ? { Cookie: cookie } : {} });
}
before(async () => {
  admin = database();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  pool = new Pool({
    ...admin.options,
    password: process.env.DB_PASSWORD,
    options: `-c search_path=${schema}`,
  });
  for (const file of ["001_catalog.sql", "002_bookings.sql"])
    await pool.query(readFileSync("sql/" + file, "utf8"));
  day = (
    await pool.query(
      "SELECT ((now() AT TIME ZONE 'America/La_Paz')::date+1)::text AS day",
    )
  ).rows[0].day;
  await pool.query("DELETE FROM weekly_hours");
  await pool.query(
    "INSERT INTO weekly_hours(weekday,opens,closes) VALUES(extract(dow from $1::date),'09:00','18:00')",
    [day],
  );
  app = await createApplication(pool);
  await app.listen(0, "127.0.0.1");
  url = await app.getUrl();
});
after(async () => {
  await app?.close();
  await pool?.end();
  if (admin) {
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});
test("registro asigna cliente y protege contraseña y sesión", async () => {
  const r = await post("/api/auth/register", {
    name: "Alicia Demo",
    email: "ALICIA@example.test",
    password,
    role: "manager",
  });
  assert.equal(r.status, 201);
  const { user } = await r.json();
  ownerId = user.id;
  assert.equal(user.role, "client");
  assert.equal(user.email, "alicia@example.test");
  assert.equal(user.password_hash, undefined);
  const cookie = r.headers.get("set-cookie")!;
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  alice = cookie.split(";")[0];
  const stored = (
    await pool.query("SELECT password_hash FROM accounts WHERE id=$1", [
      ownerId,
    ])
  ).rows[0];
  assert.notEqual(stored.password_hash, password);
  assert.match(stored.password_hash, /^scrypt\$/);
  assert.equal((await get("/api/auth/me", alice)).status, 200);
  const second = await post("/api/auth/register", {
    name: "Bruno Demo",
    email: "bruno@example.test",
    password,
  });
  assert.equal(second.status, 201);
  bob = second.headers.get("set-cookie")!.split(";")[0];
  assert.equal(
    (
      await post("/api/auth/register", {
        name: "Duplicado",
        email: "alicia@example.test",
        password,
      })
    ).status,
    409,
  );
});
test("autenticación, validación y protección de solicitudes", async () => {
  assert.equal((await get("/api/bookings")).status, 401);
  assert.equal(
    (
      await post("/api/bookings", {
        serviceId: 1,
        startsAt: day + "T13:00:00Z",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await post("/api/auth/login", {
        email: "alicia@example.test",
        password: "Contraseña-equivocada",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await post("/api/auth/register", {
        name: "X",
        email: "mal",
        password: "corta",
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await fetch(url + "/api/auth/logout", {
        method: "POST",
        headers: { Cookie: alice },
      })
    ).status,
    403,
  );
  const login = await post("/api/auth/login", {
    email: "alicia@example.test",
    password,
  });
  assert.equal(login.status, 200);
  const session = login.headers.get("set-cookie")!.split(";")[0];
  assert.notEqual(session, alice);
  assert.equal((await post("/api/auth/logout", {}, session)).status, 204);
  assert.equal((await get("/api/auth/me", session)).status, 401);
});
test("dos solicitudes simultáneas superpuestas aceptan exactamente una", async () => {
  const results = await Promise.all([
    post(
      "/api/bookings",
      { serviceId: 2, startsAt: day + "T13:00:00Z" },
      alice,
    ),
    post("/api/bookings", { serviceId: 1, startsAt: day + "T13:15:00Z" }, bob),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal(
    (await pool.query("SELECT count(*)::int AS n FROM bookings")).rows[0].n,
    1,
  );
  await pool.query("DELETE FROM bookings");
});
test("base de datos rechaza superposición incluso al saltar la API", async () => {
  const client = await pool.connect();
  const other = await pool.connect();
  try {
    await client.query("BEGIN");
    await other.query("BEGIN");
    await client.query(
      "INSERT INTO bookings(account_id,service_id,service_name,starts_at,ends_at) VALUES($1,1,'Prueba',$2,$3)",
      [ownerId, day + "T13:00:00Z", day + "T13:30:00Z"],
    );
    const competing = other
      .query(
        "INSERT INTO bookings(account_id,service_id,service_name,starts_at,ends_at) VALUES($1,1,'Prueba',$2,$3)",
        [ownerId, day + "T13:15:00Z", day + "T13:45:00Z"],
      )
      .then(
        () => null,
        (e) => e.code,
      );
    await client.query("COMMIT");
    assert.equal(await competing, "23P01");
    await other.query("ROLLBACK");
  } finally {
    client.release();
    other.release();
    await pool.query("DELETE FROM bookings");
  }
});
test("reserva persistente calcula fin y propietario en servidor; permite citas contiguas", async () => {
  const r = await post(
    "/api/bookings",
    {
      serviceId: 1,
      startsAt: day + "T13:00:00Z",
      endsAt: day + "T18:00:00Z",
      accountId: 999,
    },
    alice,
  );
  assert.equal(r.status, 201);
  const { booking } = await r.json();
  assert.equal(booking.endsAt, day + "T13:30:00.000Z");
  assert.equal(
    (
      await post(
        "/api/bookings",
        { serviceId: 1, startsAt: day + "T13:30:00Z" },
        alice,
      )
    ).status,
    201,
  );
  assert.equal(
    (await (await get("/api/bookings", alice)).json()).bookings.length,
    2,
  );
  assert.deepEqual(
    (await (await get("/api/bookings?accountId=" + ownerId, bob)).json())
      .bookings,
    [],
  );
  const available = await (
    await get("/api/services/1/availability?date=" + day)
  ).json();
  assert.ok(
    !available.slots.some(
      (s: { startsAt: string }) => s.startsAt === day + "T13:00:00.000Z",
    ),
  );
  await pool.query("UPDATE services SET duration_minutes=45 WHERE id=1");
  assert.equal(
    (
      await pool.query("SELECT ends_at FROM bookings WHERE id=$1", [booking.id])
    ).rows[0].ends_at.toISOString(),
    day + "T13:30:00.000Z",
  );
  await pool.query("UPDATE services SET duration_minutes=30 WHERE id=1");
});
test("rechaza bloqueos, fuera de horario, pasado y entradas no válidas", async () => {
  await pool.query(
    "INSERT INTO schedule_blocks(starts_at,ends_at) VALUES($1,$2)",
    [day + "T15:00:00Z", day + "T15:30:00Z"],
  );
  for (const start of [
    day + "T15:00:00Z",
    day + "T12:00:00Z",
    day + "T14:07:00Z",
  ])
    assert.equal(
      (await post("/api/bookings", { serviceId: 1, startsAt: start }, alice))
        .status,
      409,
    );
  assert.equal(
    (
      await post(
        "/api/bookings",
        { serviceId: 1, startsAt: "2000-01-01T13:00:00Z" },
        alice,
      )
    ).status,
    400,
  );
  assert.equal(
    (await post("/api/bookings", { serviceId: 1, startsAt: "invalid" }, alice))
      .status,
    400,
  );
  assert.equal((await post("/api/bookings", null, alice)).status, 400);
  assert.equal(
    (
      await post(
        "/api/bookings",
        { serviceId: 999, startsAt: day + "T14:00:00Z" },
        alice,
      )
    ).status,
    404,
  );
});
test("sesión vencida no permite consultar ni crear reservas", async () => {
  await pool.query("UPDATE sessions SET expires_at=now()-interval '1 second'");
  assert.equal((await get("/api/bookings", alice)).status, 401);
  assert.equal(
    (
      await post(
        "/api/bookings",
        { serviceId: 1, startsAt: day + "T17:00:00Z" },
        alice,
      )
    ).status,
    401,
  );
});
test("limita intentos de acceso repetidos", async () => {
  let response: Response | undefined;
  for (let i = 0; i < 21; i++)
    response = await post("/api/auth/login", {
      email: "invalido",
      password: "x",
    });
  assert.equal(response!.status, 429);
});
