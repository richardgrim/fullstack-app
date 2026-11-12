import { database } from "./database";
// Herramienta local: no hay endpoint de promoción ni cuentas privilegiadas predeterminadas.
async function main() {
  const [email, confirmation] = process.argv.slice(2);
  if (!email || email.length > 254)
    throw new Error("Uso: node dist/src/promote-manager.js correo [--confirm]");
  const pool = database();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      "SELECT id,name,email,role FROM accounts WHERE email=$1 FOR UPDATE",
      [email.trim().toLowerCase()],
    );
    if (result.rowCount !== 1)
      throw new Error(
        "No existe esa cuenta. Créala primero desde la aplicación.",
      );
    const user = result.rows[0];
    if (user.role === "manager") {
      console.log("La cuenta ya tiene rol de responsable.");
      await client.query("ROLLBACK");
      return;
    }
    console.log(
      `Cuenta seleccionada: ${user.name} <${user.email}>. Rol actual: ${user.role}.`,
    );
    if (confirmation !== "--confirm") {
      console.log(
        "Sin cambios. Tras aprobar el acceso a todas las citas, repite con --confirm.",
      );
      await client.query("ROLLBACK");
      return;
    }
    await client.query("UPDATE accounts SET role='manager' WHERE id=$1", [
      user.id,
    ]);
    await client.query("DELETE FROM sessions WHERE account_id=$1", [user.id]);
    await client.query("COMMIT");
    console.log(
      "Rol de responsable activado. Inicia sesión nuevamente para acceder a la agenda.",
    );
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
    await pool.end();
  }
}
main().catch((e) => {
  console.error(
    e instanceof Error && !("code" in e)
      ? e.message
      : "No se pudo actualizar el rol. Revisa la conexión.",
  );
  process.exitCode = 1;
});
