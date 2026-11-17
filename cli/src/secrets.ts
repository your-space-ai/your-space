// Replacing a secret, and starting with new ones: the installation guide's steps, in order
// ("Replace a Secret", "Lost Secrets", "Give PostgreSQL the Database Password").
import type { Compose } from "./compose.ts";

export type SecretName = "auth-secret" | "database-password";

export const SECRET_ENV: Record<SecretName, string> = {
  "auth-secret": "BETTER_AUTH_SECRET",
  "database-password": "POSTGRES_PASSWORD",
};

/** The guide's psql step: reads the password inside the container, so it never reaches a log. */
export const GIVE_POSTGRES_PASSWORD = `SET log_min_error_statement = panic;
\\set pw \`if [ -n "$POSTGRES_PASSWORD" ]; then printf '%s' "$POSTGRES_PASSWORD"; else cat /run/ys-secrets/password; fi\`
SELECT :'pw' <> '' AS found \\gset
\\if :found
ALTER ROLE yourspace PASSWORD :'pw';
\\else
\\echo 'No database password in .env or ys-secrets, so nothing was changed.'
\\endif
`;

export async function newSecrets(compose: Compose, names: SecretName[]): Promise<void> {
  await compose.must(["run", "--rm", "secrets", ...names.flatMap((name) => ["--new", name])], "Couldn't generate the new secrets.");
}

/** Gives PostgreSQL the database password now in use, through its own socket. */
export async function givePostgresPassword(compose: Compose): Promise<void> {
  await compose.must(["up", "-d", "--wait", "postgres"], "PostgreSQL didn't start.");
  await compose.must(
    ["exec", "-T", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-U", "yourspace", "-d", "yourspace"],
    "Couldn't give PostgreSQL the new database password.",
    { input: GIVE_POSTGRES_PASSWORD },
  );
}
