// Server entry point (T013): validate config, migrate, then listen on port 3000.
import type { Server } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { createApp } from "./app.ts";
import { createAuth } from "./auth.ts";
import { ConfigError, loadConfig } from "./config.ts";
import { createDatabase } from "./db/client.ts";
import { errorFields, log } from "./log.ts";
import { runMigrations } from "./migrate.ts";

const PORT = Number(process.env.PORT ?? 3000);
const MIGRATE_ATTEMPTS = 30;

let config;
try {
  config = loadConfig();
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

const { pool, db } = createDatabase(config.databaseUrl);

// Compose starts the server once Postgres reports healthy, but the database can still be briefly
// unreachable. Retry for about a minute before giving up, so a slow start is not a crash loop.
for (let attempt = 1; ; attempt++) {
  try {
    await runMigrations(pool);
    break;
  } catch (error) {
    log("warn", "db.unavailable_at_start", { attempt, ...errorFields(error) });
    if (attempt >= MIGRATE_ATTEMPTS) {
      console.error("Could not reach the database to apply migrations. Check that the postgres service is running.");
      process.exit(1);
    }
    await sleep(2_000);
  }
}

const auth = createAuth({ config, db });
const app = createApp({ auth, db });
const server: Server = app.listen(PORT, "0.0.0.0", () => {
  log("info", "server.listening", { port: PORT });
});

function shutdown(signal: string): void {
  log("info", "server.stopping", { signal });
  server.close(() => {
    void pool.end().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
