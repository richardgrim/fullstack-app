import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { createApplication, validDate } from "../src/app";
import { database } from "../src/database";
test("rechaza fechas inexistentes y formatos ambiguos", () => {
  assert.equal(validDate("2026-02-30"), false);
  assert.equal(validDate("09/11/2026"), false);
  assert.equal(validDate("2028-02-29"), true);
  assert.equal(validDate(["2026-11-09"]), false);
});
// Esquema aislado: las pruebas nunca alteran las tablas de la aplicación.
const schema = "test_catalog_" + Date.now();
let admin: Pool;
let pool: Pool;
let app: Awaited<ReturnType<typeof createApplication>>;
let url: string;
let day: string;
before(async () => {
  admin = database();
  await admin.query(`CREATE SCHEMA "${schema}"`);
  pool = new Pool({
    ...admin.options,
    password: process.env.DB_PASSWORD,
    options: `-c search_path=${schema}`,
  });
  await pool.query(readFileSync("sql/001_catalog.sql", "utf8"));
  await pool.query(readFileSync("sql/002_bookings.sql", "utf8"));
  const date = await pool.query(
    "SELECT ((now() AT TIME ZONE 'America/La_Paz')::date + 1)::text AS day",
  );
  day = date.rows[0].day;
  await pool.query("DELETE FROM weekly_hours");
  await pool.query(
    "INSERT INTO weekly_hours(weekday,opens,closes) VALUES(extract(dow from $1::date),'09:00','12:00')",
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
test("catálogo expone tres servicios activos y no campos internos", async () => {
  const r = await fetch(url + "/api/services");
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.services.length, 3);
  assert.equal(body.timeZone, "America/La_Paz");
  assert.deepEqual(Object.keys(body.services[0]).sort(), [
    "description",
    "durationMinutes",
    "id",
    "name",
  ]);
});
test("duración y cierre limitan cupos de 60 minutos", async () => {
  const r = await fetch(`${url}/api/services/2/availability?date=${day}`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.slots.length, 9);
  assert.equal(body.slots[0].startsAt, day + "T13:00:00.000Z");
  assert.equal(body.slots.at(-1).endsAt, day + "T16:00:00.000Z");
});
test("bloqueos excluyen superposición pero permiten extremos contiguos", async () => {
  await pool.query(
    "INSERT INTO schedule_blocks(starts_at,ends_at) VALUES($1,$2)",
    [day + "T10:00:00-04:00", day + "T10:30:00-04:00"],
  );
  try {
    const r = await fetch(`${url}/api/services/1/availability?date=${day}`);
    const body = await r.json();
    const starts = body.slots.map((s: { startsAt: string }) => s.startsAt);
    assert.ok(starts.includes(day + "T13:30:00.000Z"));
    assert.ok(starts.includes(day + "T14:30:00.000Z"));
    assert.ok(!starts.includes(day + "T13:45:00.000Z"));
    assert.ok(!starts.includes(day + "T14:15:00.000Z"));
  } finally {
    await pool.query("DELETE FROM schedule_blocks");
  }
});
test("sin apertura el día no ofrece cupos", async () => {
  await pool.query("UPDATE weekly_hours SET weekday=(weekday+1)%7");
  try {
    const r = await fetch(`${url}/api/services/1/availability?date=${day}`);
    assert.deepEqual((await r.json()).slots, []);
  } finally {
    await pool.query("UPDATE weekly_hours SET weekday=(weekday+6)%7");
  }
});
test("valida fechas, pasado, horizonte y servicio inexistente", async () => {
  for (const query of [
    "date=2026-02-30",
    "date=2000-01-01",
    "date=2999-01-01",
    "date=x",
    "date=" + day + "&date=" + day,
  ])
    assert.equal(
      (await fetch(url + "/api/services/1/availability?" + query)).status,
      400,
    );
  assert.equal(
    (await fetch(`${url}/api/services/999/availability?date=${day}`)).status,
    404,
  );
  assert.equal(
    (await fetch(`${url}/api/services/abc/availability?date=${day}`)).status,
    400,
  );
});
