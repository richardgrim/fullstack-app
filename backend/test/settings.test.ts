import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { createApplication } from "../src/app";
import { database } from "../src/database";
const schema = "test_settings_" + Date.now(),
  managerToken = "a".repeat(64),
  clientToken = "b".repeat(64);
let admin: Pool,
  pool: Pool,
  app: Awaited<ReturnType<typeof createApplication>>,
  url: string,
  day: string,
  weekday: number,
  owner: number;
async function post(path: string, body: unknown, token = managerToken) {
  return fetch(url + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Agenda-Request": "1",
      Cookie: "agenda_session=" + token,
    },
    body: JSON.stringify(body),
  });
}
async function get(path: string, token = managerToken) {
  return fetch(url + path, { headers: { Cookie: "agenda_session=" + token } });
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
  const date = (
    await pool.query(
      "SELECT ((now() AT TIME ZONE 'America/La_Paz')::date+1)::text AS day,extract(dow from (now() AT TIME ZONE 'America/La_Paz')::date+1)::int AS weekday",
    )
  ).rows[0];
  day = date.day;
  weekday = date.weekday;
  for (const [role, token] of [
    ["manager", managerToken],
    ["client", clientToken],
  ]) {
    const r = await pool.query(
      "INSERT INTO accounts(name,email,password_hash,role) VALUES($1::text,$2,'not-a-login-hash',$1::text) RETURNING id",
      [role, role + "@example.test"],
    );
    owner = r.rows[0].id;
    await pool.query(
      "INSERT INTO sessions(token_hash,account_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
      [createHash("sha256").update(token).digest("hex"), owner],
    );
  }
  app = await createApplication(pool);
  await app.listen(0, "127.0.0.1");
  url = await app.getUrl();
});
beforeEach(async () => {
  await pool.query("DELETE FROM bookings");
  await pool.query("DELETE FROM schedule_blocks");
  await pool.query("DELETE FROM weekly_hours");
  await pool.query(
    "INSERT INTO weekly_hours(weekday,opens,closes) VALUES($1,'09:00','18:00')",
    [weekday],
  );
  await pool.query(
    "UPDATE services SET name='Consulta',duration_minutes=30,active=true WHERE id=1",
  );
});
after(async () => {
  await app?.close();
  await pool?.end();
  if (admin) {
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});
async function booking() {
  return post(
    "/api/bookings",
    { serviceId: 1, startsAt: day + "T13:00:00Z" },
    clientToken,
  );
}
test("configuración y escrituras requieren responsable", async () => {
  assert.equal((await get("/api/management/settings", "")).status, 401);
  assert.equal(
    (await get("/api/management/settings", clientToken)).status,
    403,
  );
  for (const path of [
    "/services",
    "/services/1",
    `/hours/${weekday}`,
    "/blocks",
    "/blocks/1/remove",
  ])
    assert.equal(
      (await post("/api/management/settings" + path, {}, clientToken)).status,
      403,
    );
  const r = await get("/api/management/settings");
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.equal(data.services.length, 3);
  assert.equal(data.hours[0].opens, "09:00");
});
test("servicios nuevos y actualizados no reescriben citas históricas", async () => {
  const b = await booking();
  assert.equal(b.status, 201);
  const saved = (await b.json()).booking;
  const input = {
    name: "Consulta actualizada",
    description: "Descripción de prueba",
    durationMinutes: 60,
    active: false,
  };
  assert.equal(
    (await post("/api/management/settings/services/1", input)).status,
    200,
  );
  const publicCatalog = await (await get("/api/services")).json();
  assert.ok(!publicCatalog.services.some((s: { id: number }) => s.id === 1));
  const persisted = (
    await pool.query("SELECT service_name,ends_at FROM bookings WHERE id=$1", [
      saved.id,
    ])
  ).rows[0];
  assert.equal(persisted.service_name, "Consulta");
  assert.equal(persisted.ends_at.toISOString(), day + "T13:30:00.000Z");
  assert.equal(
    (
      await post("/api/management/settings/services", {
        ...input,
        active: true,
      })
    ).status,
    201,
  );
  assert.equal(
    (
      await post("/api/management/settings/services", {
        ...input,
        durationMinutes: 14,
      })
    ).status,
    400,
  );
  assert.equal(
    (await post("/api/management/settings/services/99999", input)).status,
    404,
  );
});
test("cambiar horario protege citas, permite ampliación y cerrar días vacíos", async () => {
  await booking();
  assert.equal(
    (await post(`/api/management/settings/hours/${weekday}`, { periods: [] }))
      .status,
    409,
  );
  assert.equal(
    (
      await post(`/api/management/settings/hours/${weekday}`, {
        periods: [{ opens: "09:15", closes: "18:00" }],
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await post(`/api/management/settings/hours/${weekday}`, {
        periods: [{ opens: "08:00", closes: "18:00" }],
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await post(`/api/management/settings/hours/${(weekday + 1) % 7}`, {
        periods: [],
      })
    ).status,
    200,
  );
  const hours = (
    await pool.query("SELECT opens::text FROM weekly_hours WHERE weekday=$1", [
      weekday,
    ])
  ).rows;
  assert.equal(hours[0].opens, "08:00:00");
});
test("rechaza horarios inválidos, superpuestos y cuerpos malformados", async () => {
  for (const periods of [
    [{ opens: "12:00", closes: "09:00" }],
    [{ opens: "25:00", closes: "26:00" }],
    [
      { opens: "09:00", closes: "12:00" },
      { opens: "11:00", closes: "14:00" },
    ],
    [null],
  ])
    assert.equal(
      (await post(`/api/management/settings/hours/${weekday}`, { periods }))
        .status,
      400,
    );
  assert.equal(
    (await post("/api/management/settings/hours/7", { periods: [] })).status,
    400,
  );
  assert.equal(
    (await post(`/api/management/settings/hours/${weekday}`, null)).status,
    400,
  );
});
test("bloqueos protegen citas, admiten extremos contiguos y pueden quitarse", async () => {
  await booking();
  assert.equal(
    (
      await post("/api/management/settings/blocks", {
        date: day,
        opens: "09:15",
        closes: "10:00",
      })
    ).status,
    409,
  );
  const r = await post("/api/management/settings/blocks", {
    date: day,
    opens: "09:30",
    closes: "10:00",
  });
  assert.equal(r.status, 201);
  const { block } = await r.json();
  assert.equal(
    (
      await post("/api/management/settings/blocks", {
        date: day,
        opens: "09:45",
        closes: "10:15",
      })
    ).status,
    409,
  );
  let available = await (
    await get("/api/services/1/availability?date=" + day)
  ).json();
  assert.ok(
    !available.slots.some(
      (s: { startsAt: string }) => s.startsAt === day + "T13:30:00.000Z",
    ),
  );
  assert.equal(
    (await post(`/api/management/settings/blocks/${block.id}/remove`, {}))
      .status,
    200,
  );
  available = await (
    await get("/api/services/1/availability?date=" + day)
  ).json();
  assert.ok(
    available.slots.some(
      (s: { startsAt: string }) => s.startsAt === day + "T13:30:00.000Z",
    ),
  );
  assert.equal(
    (await post(`/api/management/settings/blocks/${block.id}/remove`, {}))
      .status,
    404,
  );
});
test("bloqueo rechaza pasado, fechas imposibles y horizonte excesivo", async () => {
  for (const date of ["2000-01-01", "2026-02-30", "2999-01-01"])
    assert.equal(
      (
        await post("/api/management/settings/blocks", {
          date,
          opens: "09:00",
          closes: "10:00",
        })
      ).status,
      400,
    );
});
test("reserva y bloqueo simultáneos nunca quedan superpuestos", async () => {
  const r = await Promise.all([
    booking(),
    post("/api/management/settings/blocks", {
      date: day,
      opens: "09:00",
      closes: "09:30",
    }),
  ]);
  assert.deepEqual(r.map((x) => x.status).sort(), [201, 409]);
  const conflicts = await pool.query(
    "SELECT count(*)::int AS n FROM bookings b JOIN schedule_blocks s ON b.starts_at<s.ends_at AND b.ends_at>s.starts_at WHERE b.status='confirmed'",
  );
  assert.equal(conflicts.rows[0].n, 0);
});
test("cerrar día y reservar simultáneamente conservan coherencia", async () => {
  const r = await Promise.all([
    booking(),
    post(`/api/management/settings/hours/${weekday}`, { periods: [] }),
  ]);
  const statuses = r.map((x) => x.status);
  assert.ok(
    (statuses[0] === 201 && statuses[1] === 409) ||
      (statuses[0] === 409 && statuses[1] === 200),
  );
  const bookings = (await pool.query("SELECT count(*)::int AS n FROM bookings"))
    .rows[0].n;
  const hours = (
    await pool.query("SELECT count(*)::int AS n FROM weekly_hours")
  ).rows[0].n;
  assert.ok(bookings === 0 || hours > 0);
});
