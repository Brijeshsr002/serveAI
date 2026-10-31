import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

// Tests run against a real, throwaway PostgreSQL with the real migrations applied.
export default async function setup() {
  const databaseDir = path.resolve(".pgtest");
  rmSync(databaseDir, { recursive: true, force: true });
  const pg = new EmbeddedPostgres({
    databaseDir,
    user: "serveai",
    password: "serveai",
    port: 5434,
    persistent: false,
    initdbFlags: ["--encoding=UTF8", "--locale=C"],
    onLog: () => {},
    onError: () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("serveai_test");
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: "postgresql://serveai:serveai@localhost:5434/serveai_test" },
    stdio: "pipe",
  });
  return async () => {
    await pg.stop();
  };
}
