// The two platform secrets on a real stack (research R16): generated once on the first start with
// an empty .env, kept across restarts and recreation, PostgreSQL limited to its own file, values set
// in .env used as given, and the installation guide's "Lost Secrets" steps bringing a workspace
// back after its ys-secrets volume or its .env password changed.
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { compose, composeWithInput, createOwner, identities, logs, resetStack, serverCommand, up } from "./helpers/stack.ts";

const run = promisify(execFile);

test.skip(({ browserName }) => browserName !== "chromium", "These checks drive Compose, not a browser; run them once.");
test.describe.configure({ mode: "serial" });

// The SQL of "Give PostgreSQL the Database Password" in docs/operate/recovery.md, fed on stdin as the
// guide's heredoc does. Keep the two in step.
const GIVE_POSTGRES_THE_PASSWORD = `SET log_min_error_statement = panic;
\\set pw \`if [ -n "$POSTGRES_PASSWORD" ]; then printf '%s' "$POSTGRES_PASSWORD"; else cat /run/ys-secrets/password; fi\`
SELECT :'pw' <> '' AS found \\gset
\\if :found
ALTER ROLE yourspace PASSWORD :'pw';
\\else
\\echo 'No database password in .env or ys-secrets, so nothing was changed.'
\\endif
`;

test("the guide prints the same password command these tests run", () => {
  const guide = readFileSync(new URL("../../docs/operate/recovery.md", import.meta.url), "utf8");
  const section = guide.slice(guide.indexOf("### Give PostgreSQL the Database Password"));
  const heredoc = section.slice(section.indexOf("<<'EOF'\n") + "<<'EOF'\n".length, section.indexOf("\nEOF\n") + 1);
  expect(heredoc).toBe(GIVE_POSTGRES_THE_PASSWORD);
});

function givePostgresThePassword(env: Record<string, string> = {}) {
  return composeWithInput(["exec", "-T", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-U", "yourspace", "-d", "yourspace"], GIVE_POSTGRES_THE_PASSWORD, env);
}

async function shownSecrets(): Promise<Record<string, { source: string; value: string }>> {
  const shown = await serverCommand("show-secrets");
  expect(shown.code, shown.stderr).toBe(0);
  return Object.fromEntries((shown.json.secrets as { name: string; source: string; value: string }[]).map((s) => [s.name, s]));
}

test("an empty .env gets generated secrets that survive restarts, and PostgreSQL sees only its own", async () => {
  await resetStack();
  const first = await shownSecrets();
  expect(first.BETTER_AUTH_SECRET).toMatchObject({ source: "generated", value: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
  expect(first.POSTGRES_PASSWORD).toMatchObject({ source: "generated", value: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });

  const stepLog = await logs(["secrets"]);
  expect(stepLog).toContain('"event":"secrets.generated"');
  for (const { value } of Object.values(first)) expect(stepLog).not.toContain(value);

  // Only the database password is in PostgreSQL's view, and the server can't change the volume even
  // where it owns the files.
  expect((await compose(["exec", "-T", "postgres", "ls", "/run/ys-secrets"])).stdout.trim()).toBe("password");
  const write = await compose(["exec", "-T", "server", "sh", "-c", "touch /run/ys-secrets/auth/probe"], { allowFailure: true });
  expect(write.code).not.toBe(0);
  expect(write.stderr).toMatch(/Read-only file system/);
  // Generated values never enter a container's environment, so docker inspect can't show them.
  expect((await compose(["exec", "-T", "server", "printenv", "BETTER_AUTH_SECRET"], { allowFailure: true })).stdout.trim()).toBe("");

  await compose(["down"]);
  await up();
  expect(await shownSecrets()).toEqual(first);
  expect(await logs(["secrets"])).toContain('"event":"secrets.kept"');
});

test("a lost ys-secrets volume stops start-up, and the guide's steps recover the workspace", async () => {
  await resetStack();
  await createOwner();
  const before = await identities();

  await compose(["down"]);
  await run("docker", ["volume", "rm", "ys-e2e_ys-secrets"]);
  const refused = await compose(["up", "-d", "--wait"], { allowFailure: true, timeout: 240_000 });
  expect(refused.code).not.toBe(0);
  const stepLog = await logs(["secrets"]);
  expect(stepLog).toContain("The auth secret and the database password aren't in .env or in the ys-secrets volume");
  expect(stepLog).toContain('"Lost Secrets"');
  // Nothing was generated over the existing database.
  expect((await compose(["ps", "-a", "--format", "{{.Service}} {{.State}}"])).stdout).not.toMatch(/server running/);

  // "Lost Secrets", option 2, in docs/operate/recovery.md.
  await compose(["run", "--rm", "secrets", "--new", "auth-secret", "--new", "database-password"]);
  await compose(["up", "-d", "--wait", "postgres"], { timeout: 240_000 });
  expect((await givePostgresThePassword()).stdout).toContain("ALTER ROLE");
  await up();

  // The server is healthy with the new password, and the workspace is the same one.
  expect(await identities()).toEqual(before);
});

test("secrets set in .env are used as given, and a changed password is recovered with the guide's command", async () => {
  // Both secrets in .env, as an owner who keeps them in a password manager sets them. The password has
  // characters that need escaping in a URL.
  const given = { BETTER_AUTH_SECRET: "an-owner-supplied-auth-secret-0123456789", POSTGRES_PASSWORD: "p@ss/w#rd:%41 ?&=" };
  await resetStack(given);
  await createOwner();
  const before = await identities();
  const shown = await shownSecrets();
  expect(shown.BETTER_AUTH_SECRET).toEqual({ name: "BETTER_AUTH_SECRET", source: "env", value: given.BETTER_AUTH_SECRET });
  expect(shown.POSTGRES_PASSWORD).toEqual({ name: "POSTGRES_PASSWORD", source: "env", value: given.POSTGRES_PASSWORD });
  // Copied nowhere: the folders PostgreSQL and the server mount exist, but hold no secret.
  expect((await compose(["exec", "-T", "server", "ls", "-A", "/run/ys-secrets/auth", "/run/ys-secrets/postgres"])).stdout).not.toMatch(/secret$|password$/m);

  // The owner changes the password in .env. PostgreSQL keeps the old one, so the server says so.
  const changed = { ...given, POSTGRES_PASSWORD: "a-new-password-from-the-manager" };
  const refused = await compose(["up", "-d", "--wait"], { allowFailure: true, timeout: 240_000, env: changed });
  expect(refused.code).not.toBe(0);
  expect(await logs(["server"])).toContain("PostgreSQL refused the database password");

  // "Give PostgreSQL the Database Password" in docs/operate/recovery.md, then start again.
  expect((await givePostgresThePassword(changed)).stdout).toContain("ALTER ROLE");
  await compose(["restart", "server"], { env: changed });
  await up(changed);
  expect(await identities()).toEqual(before);
});
