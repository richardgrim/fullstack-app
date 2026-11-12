import { createApplication } from "./app";
import { database } from "./database";
async function main() {
  const pool = database();
  await pool.query("SELECT 1 FROM services LIMIT 1");
  const app = await createApplication(pool);
  await app.listen(3001, "127.0.0.1");
  console.log("Reservas API disponible en http://127.0.0.1:3001");
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, () => {
      void app.close().then(() => pool.end());
    });
}
main().catch(() => {
  console.error(
    "No se pudo iniciar Reservas. Revisa DB_PASSWORD, PostgreSQL y las migraciones.",
  );
  process.exitCode = 1;
});
