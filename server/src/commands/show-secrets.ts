// Prints the two platform secrets and where each comes from (contracts/operator-commands.md):
//   docker compose exec server show-secrets [--json]
// For owners who want to keep the generated values in their own password manager, or move them
// into .env. Prints to the terminal only; nothing is logged.
import { SECRETS, resolveSecret, SECRETS_DIR, type Source } from "../secrets.ts";

export interface ShownSecret {
  name: string;
  label: string;
  source: Source;
  value: string;
}

/** The secrets in use, or the settings that have none yet. */
export function describeSecrets(env: NodeJS.ProcessEnv, dir: string = SECRETS_DIR): { shown: ShownSecret[]; missing: string[] } {
  const shown: ShownSecret[] = [];
  const missing: string[] = [];
  for (const spec of SECRETS) {
    const resolved = resolveSecret(spec, env, dir);
    if (resolved) shown.push({ name: spec.env, label: spec.label, ...resolved });
    else missing.push(spec.env);
  }
  return { shown, missing };
}
