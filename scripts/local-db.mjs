// Runs a real PostgreSQL locally without Docker. Development only.
// Usage: npm run db:local   (leave running; DATABASE_URL in .env.example points at it)
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import path from "node:path";

const databaseDir = path.resolve(process.env.PG_DATA_DIR ?? ".pgdata");
const port = Number(process.env.PG_PORT ?? 5433);
const database = process.env.PG_DATABASE ?? "serveai";

const pg = new EmbeddedPostgres({
  databaseDir,
  user: "serveai",
  password: "serveai",
  port,
  persistent: true,
  // Windows otherwise defaults to WIN1252, which cannot store the rupee sign.
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
});

if (!existsSync(path.join(databaseDir, "PG_VERSION"))) await pg.initialise();
await pg.start();
await pg.createDatabase(database).catch((err) => {
  if (!String(err?.message ?? err).includes("already exists")) throw err;
});
console.log(`Postgres ready: postgresql://serveai:serveai@localhost:${port}/${database}`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
