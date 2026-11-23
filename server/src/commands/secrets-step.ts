// The `secrets` service in deploy/stack.yaml: settles the two platform secrets before PostgreSQL
// and the server start, then exits (research R16). It runs with no network, as root only so it can
// give each file to the user that reads it.
//
//   docker compose run --rm secrets --new auth-secret         new auth secret; then restart the server,
//                                                             which signs out every device
//   docker compose run --rm secrets --new database-password   new database password (see the guide)
//   docker compose run --rm secrets --new data-key            new data key; restart the server, which
//                                                             re-encrypts with it, then:
//   docker compose run --rm secrets --forget previous-data-key
import { log } from "../log.ts";
import { forgetPreviousDataKey, SECRETS, SECRETS_DIR, SecretsError, settleSecrets, type SecretSpec } from "../secrets.ts";

const DATABASE_DIR = "/pgdata";

const args = process.argv.slice(2);
if (args.length === 2 && args[0] === "--forget" && args[1] === "previous-data-key") {
  const forgotten = forgetPreviousDataKey(SECRETS_DIR);
  log("info", forgotten ? "secrets.previous_data_key_forgotten" : "secrets.no_previous_data_key", {});
  process.exit(0);
}

function parseArguments(args: string[]): SecretSpec[] | string {
  const replace: SecretSpec[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--new") return `Unknown argument: ${args[i]}`;
    const spec = SECRETS.find((candidate) => candidate.argument === args[i + 1]);
    if (!spec) return `--new takes ${SECRETS.map((s) => s.argument).join(" or ")}.`;
    replace.push(spec);
    i++;
  }
  return replace;
}

const replace = parseArguments(args);
if (typeof replace === "string") {
  console.error(replace);
  process.exit(1);
}

// What an operator must do after `--new`: the running server keeps the secrets it started with.
const AFTER_REPLACING: Record<string, string> = {
  BETTER_AUTH_SECRET:
    "Replaced the auth secret. Restart the server to use it, which signs out every device: docker compose restart server",
  POSTGRES_PASSWORD:
    'Replaced the database password. PostgreSQL still has the old one: follow "Lost Secrets" in the recovery guide (docs/operate/recovery.md) to give it the new one, then restart the server.',
  YS_DATA_KEY:
    "Replaced the data key. Restart the server, which re-encrypts apps' settings with it, then: docker compose run --rm secrets --forget previous-data-key",
};

try {
  for (const { spec, action } of settleSecrets({ dir: SECRETS_DIR, databaseDir: DATABASE_DIR, env: process.env, replace })) {
    // Names only, never values (FR-010).
    log("info", `secrets.${action}`, { name: spec.label, setting: spec.env });
    if (action === "replaced") console.error(AFTER_REPLACING[spec.env]);
    if (action === "not_replaced") console.error(`${spec.env} is set in .env, so it was left as it is. To change it, edit .env.`);
  }
} catch (error) {
  if (error instanceof SecretsError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
