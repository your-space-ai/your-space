// The two platform secrets on a real stack (research R16): generated once on the first start with
// an empty .env, kept across restarts and recreation, PostgreSQL limited to its own file, and the
// installation guide's "Lost Secrets" steps bringing back a workspace whose ys-secrets volume was lost.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { compose, createOwner, identities, logs, resetStack, serverCommand, up } from "./helpers/stack.ts";

const run = promisify(execFile);

test.skip(({ browserName }) => browserName !== "chromium", "These checks drive Compose, not a browser; run them once.");
test.describe.configure({ mode: "serial" });

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

  // Only the database password is in PostgreSQL's view, and the server can't change the volume.
  expect((await compose(["exec", "-T", "postgres", "ls", "/run/ys-secrets"])).stdout.trim()).toBe("password");
  const write = await compose(["exec", "-T", "server", "sh", "-c", "touch /run/ys-secrets/probe"], { allowFailure: true });
  expect(write.code).not.toBe(0);
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
  expect(stepLog).toContain("but this installation already has a");
  expect(stepLog).toContain("docker compose run --rm secrets --new auth-secret");
  // Nothing was generated over the existing database.
  expect((await compose(["ps", "-a", "--format", "{{.Service}} {{.State}}"])).stdout).not.toMatch(/server running/);

  // "Lost Secrets" in docs/install/README.md.
  await compose(["run", "--rm", "secrets", "--new", "auth-secret", "--new", "database-password"]);
  await compose(["up", "-d", "--wait", "postgres"], { timeout: 240_000 });
  await compose([
    "exec",
    "-T",
    "postgres",
    "sh",
    "-c",
    `psql -U yourspace -d yourspace -c "ALTER ROLE yourspace PASSWORD '$(cat /run/ys-secrets/password)'"`,
  ]);
  // The server becomes healthy with the new password, and the workspace is the same one.
  await up();
  expect(await identities()).toEqual(before);
});
