import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { createApplication } from "../src/app";
import { database } from "../src/database";
const schema = "test_agenda_" + Date.now();
let admin: Pool,
  pool: Pool,
  app: Awaited<ReturnType<typeof createApplication>>,
  url: string,
  day: string;
let alice: string, bob: string, manager: string, owner: number;
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
async function fixture(start: string, end: string, status = "confirmed") {
  const r = await pool.query(
    "INSERT INTO bookings(account_id,service_id,service_name,starts_at,ends_at,status) VALUES($1,1,'Consulta de prueba',$2,$3,$4) RETURNING id",
    [owner, start, end, status],
  );
  return r.rows[0].id;
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
  const cookies: string[] = [];
  for (const name of ["Alicia", "Bruno", "Responsable"]) {
    const r = await post("/api/auth/register", {
      name,
      email: name.toLowerCase() + "@example.test",
      password: "Prueba-agenda-2026!",
    });
    assert.equal(r.status, 201);
    const data = await r.json();
    if (name === "Alicia") owner = data.user.id;
    if (name === "Responsable")
      await pool.query("UPDATE accounts SET role='manager' WHERE id=$1", [
        data.user.id,
      ]);
    cookies.push(r.headers.get("set-cookie")!.split(";")[0]);
  }
  [alice, bob, manager] = cookies;
});
after(async () => {
  await app?.close();
  await pool?.end();
  if (admin) {
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
  }
});
test("cancelación exige sesión y propietario sin divulgar citas ajenas", async () => {
  const id = await fixture(day + "T13:00:00Z", day + "T13:30:00Z");
  assert.equal((await post(`/api/bookings/${id}/cancel`, {})).status, 401);
  assert.equal((await post(`/api/bookings/${id}/cancel`, {}, bob)).status, 404);
  assert.equal(
    (await post(`/api/bookings/${id}/cancel`, {}, manager)).status,
    404,
  );
  assert.equal(
    (await post("/api/bookings/999999/cancel", {}, bob)).status,
    404,
  );
  assert.equal(
    (await pool.query("SELECT status FROM bookings WHERE id=$1", [id])).rows[0]
      .status,
    "confirmed",
  );
  await pool.query("DELETE FROM bookings");
});
test("cancelar conserva historial, libera cupo y permite una nueva reserva", async () => {
  const id = await fixture(day + "T13:00:00Z", day + "T13:30:00Z");
  const before = await (await get("/api/bookings", alice)).json();
  assert.equal(before.bookings[0].canCancel, true);
  assert.equal(
    (await post(`/api/bookings/${id}/cancel`, {}, alice)).status,
    200,
  );
  assert.equal(
    (await post(`/api/bookings/${id}/cancel`, {}, alice)).status,
    409,
  );
  const mine = await (await get("/api/bookings", alice)).json();
  assert.equal(mine.bookings[0].status, "cancelled");
  assert.equal(mine.bookings[0].canCancel, false);
  const slots = await (
    await get("/api/services/1/availability?date=" + day)
  ).json();
  assert.ok(
    slots.slots.some(
      (s: { startsAt: string }) => s.startsAt === day + "T13:00:00.000Z",
    ),
  );
  assert.equal(
    (
      await post(
        "/api/bookings",
        { serviceId: 1, startsAt: day + "T13:00:00Z" },
        bob,
      )
    ).status,
    201,
  );
  await pool.query("DELETE FROM bookings");
});
test("dos cancelaciones simultáneas tienen una sola transición", async () => {
  const id = await fixture(day + "T13:00:00Z", day + "T13:30:00Z");
  const responses = await Promise.all([
    post(`/api/bookings/${id}/cancel`, {}, alice),
    post(`/api/bookings/${id}/cancel`, {}, alice),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  await pool.query("DELETE FROM bookings");
});
test("no cancela cita iniciada ni un estado final", async () => {
  const id = (
    await pool.query(
      "INSERT INTO bookings(account_id,service_id,service_name,starts_at,ends_at) VALUES($1,1,'En curso',now()-interval '1 minute',now()+interval '29 minutes') RETURNING id",
      [owner],
    )
  ).rows[0].id;
  assert.equal(
    (await post(`/api/bookings/${id}/cancel`, {}, alice)).status,
    409,
  );
  assert.equal(
    (await (await get("/api/bookings", alice)).json()).bookings[0].canCancel,
    false,
  );
  await pool.query("DELETE FROM bookings");
  for (const status of ["attended", "missed"]) {
    const key = await fixture(day + "T13:00:00Z", day + "T13:30:00Z", status);
    assert.equal(
      (await post(`/api/bookings/${key}/cancel`, {}, alice)).status,
      409,
    );
    await pool.query("DELETE FROM bookings");
  }
});
test("agenda restringida al responsable y filtros validados", async () => {
  assert.equal((await get("/api/management/agenda?date=" + day)).status, 401);
  assert.equal(
    (await get("/api/management/agenda?date=" + day, alice)).status,
    403,
  );
  for (const query of [
    "date=2026-02-30",
    "date=" + day + "&status=unknown",
    "date=" + day + "&date=" + day,
    "date=" + day + "&status=confirmed&status=missed",
  ])
    assert.equal(
      (await get("/api/management/agenda?" + query, manager)).status,
      400,
    );
  assert.equal(
    (
      await post(
        "/api/management/bookings/1/outcome",
        { status: "attended" },
        alice,
      )
    ).status,
    403,
  );
});
test("agenda filtra por día boliviano y estado sin exponer credenciales", async () => {
  // Las 02:00 UTC del día solicitado aún pertenecen al día anterior en Bolivia.
  await fixture(day + "T02:00:00Z", day + "T02:30:00Z");
  await fixture(day + "T13:00:00Z", day + "T13:30:00Z");
  await fixture(day + "T14:00:00Z", day + "T14:30:00Z", "cancelled");
  const all = await (
    await get("/api/management/agenda?date=" + day, manager)
  ).json();
  assert.equal(all.bookings.length, 2);
  assert.equal(all.bookings[0].clientName, "Alicia");
  assert.equal(all.bookings[0].canComplete, false);
  assert.deepEqual(Object.keys(all.bookings[0]).sort(), [
    "canComplete",
    "clientName",
    "endsAt",
    "id",
    "serviceName",
    "startsAt",
    "status",
  ]);
  const filtered = await (
    await get(
      "/api/management/agenda?date=" + day + "&status=cancelled",
      manager,
    )
  ).json();
  assert.equal(filtered.bookings.length, 1);
  assert.equal(filtered.bookings[0].status, "cancelled");
  await pool.query("DELETE FROM bookings");
});
test("resultado exige cita finalizada y no permite reabrir ni sobrescribir estados", async () => {
  const future = await fixture(day + "T13:00:00Z", day + "T13:30:00Z");
  assert.equal(
    (
      await post(
        `/api/management/bookings/${future}/outcome`,
        { status: "attended" },
        manager,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await post(
        `/api/management/bookings/${future}/outcome`,
        { status: "cancelled" },
        manager,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await post(
        "/api/management/bookings/999999/outcome",
        { status: "missed" },
        manager,
      )
    ).status,
    404,
  );
  await pool.query("DELETE FROM bookings");
  for (const status of ["attended", "missed"]) {
    const id = (
      await pool.query(
        "INSERT INTO bookings(account_id,service_id,service_name,starts_at,ends_at) VALUES($1,1,'Finalizada',now()-interval '2 hours',now()-interval '1 hour') RETURNING id",
        [owner],
      )
    ).rows[0].id;
    assert.equal(
      (
        await post(
          `/api/management/bookings/${id}/outcome`,
          { status },
          manager,
        )
      ).status,
      200,
    );
    assert.equal(
      (
        await post(
          `/api/management/bookings/${id}/outcome`,
          { status: status === "attended" ? "missed" : "attended" },
          manager,
        )
      ).status,
      409,
    );
    assert.equal(
      (await pool.query("SELECT status FROM bookings WHERE id=$1", [id]))
        .rows[0].status,
      status,
    );
    await pool.query("DELETE FROM bookings");
  }
});
test("resultados concurrentes no sobrescriben la primera decisión", async () => {
  const id = (
    await pool.query(
      "INSERT INTO bookings(account_id,service_id,service_name,starts_at,ends_at) VALUES($1,1,'Finalizada',now()-interval '2 hours',now()-interval '1 hour') RETURNING id",
      [owner],
    )
  ).rows[0].id;
  const responses = await Promise.all([
    post(
      `/api/management/bookings/${id}/outcome`,
      { status: "attended" },
      manager,
    ),
    post(
      `/api/management/bookings/${id}/outcome`,
      { status: "missed" },
      manager,
    ),
  ]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  await pool.query("DELETE FROM bookings");
});
