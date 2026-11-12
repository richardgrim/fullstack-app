import { readFileSync } from "node:fs";
import { database } from "./database";
async function migrate() {
  const pool = database();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(22001)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const [version, file] of [
      [1, "001_catalog.sql"],
      [2, "002_bookings.sql"],
    ] as const) {
      const applied = await client.query(
        "SELECT version FROM schema_migrations WHERE version=$1",
        [version],
      );
      if (!applied.rowCount) {
        await client.query(readFileSync("sql/" + file, "utf8"));
        await client.query(
          "INSERT INTO schema_migrations(version) VALUES($1)",
          [version],
        );
      }
    }
    await client.query("COMMIT");
    console.log("Esquema de reservas actualizado.");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}
migrate().catch(() => {
  console.error(
    "No se pudo migrar la base de reservas. Revisa conexión y esquema.",
  );
  process.exitCode = 1;
});
