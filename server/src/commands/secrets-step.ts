// The `secrets` service in deploy/stack.yaml: settles the two platform secrets before PostgreSQL
// and the server start, then exits (research R16). It runs with no network, as root only so it can
// give each file to the user that reads it.
//
//   docker compose run --rm secrets --new auth-secret         sign every device out, new auth secret
//   docker compose run --rm secrets --new database-password   new database password (see the guide)
import { log } from "../log.ts";
import { SECRETS, SECRETS_DIR, SecretsError, settleSecrets, type SecretSpec } from "../secrets.ts";

const DATABASE_DIR = "/pgdata";

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

const replace = parseArguments(process.argv.slice(2));
if (typeof replace === "string") {
  console.error(replace);
  process.exit(1);
}

try {
  for (const { spec, action } of settleSecrets({ dir: SECRETS_DIR, databaseDir: DATABASE_DIR, env: process.env, replace })) {
    // Names only, never values (FR-010).
    log("info", `secrets.${action}`, { name: spec.label, setting: spec.env });
  }
} catch (error) {
  if (error instanceof SecretsError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
