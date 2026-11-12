import { Pool } from "pg";
export function database() {
  if (!process.env.DB_PASSWORD) throw new Error("Falta DB_PASSWORD.");
  return new Pool({
    host: "127.0.0.1",
    port: 5434,
    database: "reservas",
    user: "reservas",
    password: process.env.DB_PASSWORD,
    max: 5,
    connectionTimeoutMillis: 5000,
  });
}
