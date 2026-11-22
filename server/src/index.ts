// Server entry point (T013): validate config, migrate, then listen on port 3000.
import type { Server } from "node:http";
import { setTimeout as sleep } from "node:timers/promises";
import { expireRequests } from "./agents/store.ts";
import { createApp } from "./app.ts";
import { createAuth } from "./auth.ts";
import { ConfigError, loadConfig } from "./config.ts";
import { createDatabase, isStorageError } from "./db/client.ts";
import { errorFields, log } from "./log.ts";
import { runMigrations } from "./migrate.ts";
import { createGate, Handoffs } from "./apps/gate.ts";
import { socketRuntime } from "./apps/runtime-client.ts";
import { moveSettingsToDataKey } from "./apps/keys.ts";
import { AppsService } from "./apps/service.ts";

const PORT = Number(process.env.PORT ?? 3000);
/** The gate's listener: only Caddy reaches it (deploy/Caddyfile). */
// Process-level tests launch independent servers concurrently and do not use Caddy.
const GATE_PORT = process.env.YS_E2E_EPHEMERAL_GATE === "1" ? 0 : 3001;
const RECONCILE_INTERVAL_MS = 15_000;
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
    if ((error as { code?: unknown }).code === "28P01") {
      // PostgreSQL keeps the password it was created with; .env or the volume now holds another.
      log("error", "db.password_rejected", errorFields(error));
      console.error(
        "PostgreSQL refused the database password. It keeps the password it was first created with, so " +
          "if POSTGRES_PASSWORD in .env changed, change it back, or give PostgreSQL the new one: see " +
          "\"Give PostgreSQL the Database Password\" in the installation guide.",
      );
      process.exit(1);
    }
    if (!isStorageError(error)) {
      // The database answered but a migration failed: retrying won't help.
      log("error", "db.migrate.failed", errorFields(error));
      console.error("A database migration failed, so the server did not start. Nothing was claimed or deleted.");
      process.exit(1);
    }
    log("warn", "db.unavailable_at_start", { attempt, ...errorFields(error) });
    if (attempt >= MIGRATE_ATTEMPTS) {
      console.error("Could not reach the database to apply migrations. Check that the postgres service is running.");
      process.exit(1);
    }
    await sleep(2_000);
  }
}

// Apps' settings move onto the data key before anything is served (spec 009): values from before it
// existed, and values a replaced data key left. Values no key can read are counted and left as they
// are; the app says what to do when it next needs them.
try {
  const moved = await moveSettingsToDataKey(db, config);
  if (moved.moved || moved.unreadable) log(moved.unreadable ? "warn" : "info", "settings.data_key", { ...moved });
} catch (error) {
  log("error", "settings.data_key_failed", errorFields(error));
  console.error("Apps' settings couldn't be moved onto the data key, so the server did not start. Nothing was changed.");
  process.exit(1);
}

const auth = createAuth({ config, db });
const handoffs = new Handoffs();
const apps = new AppsService(db, socketRuntime(), { publicUrl: config.publicUrl, dataKey: config.dataKey, kitsRepository: config.kitsRepository });
const app = createApp({ auth, db, dataKey: config.dataKey, apps: { service: apps, handoffs } });
const gate = createGate({ db, publicUrl: config.publicUrl, authSecret: config.authSecret, handoffs });
const gateServer: Server = gate.listen(GATE_PORT, "0.0.0.0");

// Apps that should run are started, and recorded states corrected, at start and then regularly
// (FR-007, FR-008). Each pass waits for the one before.
await apps.recoverJobs().catch((error) => log("warn", "apps.recover_failed", errorFields(error)));
let reconciling = false;
async function reconcile(): Promise<void> {
  if (reconciling) return;
  reconciling = true;
  try {
    await expireRequests(pool);
    await apps.reconcile();
  } catch (error) {
    log("warn", "apps.reconcile_failed", errorFields(error));
  } finally {
    reconciling = false;
  }
}
void reconcile();
const reconcileTimer = setInterval(() => void reconcile(), RECONCILE_INTERVAL_MS);
const server: Server = app.listen(PORT, "0.0.0.0", () => {
  // Which setup the .env produced, so `docker compose logs server` shows it.
  log("info", "server.listening", { port: PORT, setup: config.mode, address: config.publicUrl });
});

function shutdown(signal: string): void {
  log("info", "server.stopping", { signal });
  clearInterval(reconcileTimer);
  gateServer.close();
  server.close(() => {
    void pool.end().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
