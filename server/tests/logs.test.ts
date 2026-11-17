// T051 (server half): after setup, sign-in, failures, and recovery, the server's logs and the
// commands' stderr hold no passwords, tokens, links, or session values (cross-cutting scenario 2,
// FR-010). The commands' stdout delivers the link to the operator on purpose and is not a log.
// Both commands also run once in each mode on success; create-owner's human run uses a second
// database so the first keeps its single owner.
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer, type AddressInfo } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCommand, type CommandResult } from "./helpers/commands.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { send } from "./helpers/server.ts";
import { TEST_DATA_KEY, TEST_SECRET } from "./helpers/env.ts";
import { OWNER } from "./helpers/owner.ts";

const SERVER = fileURLToPath(new URL("../src/index.ts", import.meta.url));

// Synthetic passwords, each distinct so a leak names the step that caused it.
const PASSWORDS = {
  first: OWNER.password,
  wrong: "wrong horse battery staple 7",
  short: "Tiny9pass",
  recovered: "a brand new passphrase 2026",
  signUp: "visitor passphrase 48151623",
  malformed: "malformed body passphrase 42",
};

// Documentation addresses (RFC 5737), one per step so the sign-in limit only trips where intended.
const IP = {
  first: "198.51.100.11",
  second: "198.51.100.12",
  recovered: "198.51.100.13",
  limit: "198.51.100.14",
  malformed: "198.51.100.15",
  other: "198.51.100.16",
};

let t: TestDatabase;
let humanDb: TestDatabase;
let child: ChildProcess | undefined;
let baseUrl: string;
let publicUrl: string;
const serverOut = { stdout: "", stderr: "" };
const commandStderr: Record<string, string> = {};
const jsonRuns: CommandResult[] = [];
const publicErrors: string[] = [];
let responses = 0;
/** label -> value that must not appear in logs. */
const secrets = new Map<string, string>();

function secret(label: string, value: string | undefined): void {
  if (!value) return;
  secrets.set(label, value);
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {}
  if (decoded !== value) secrets.set(`${label} (decoded)`, decoded);
}

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

beforeAll(async () => {
  // The server applies the migrations itself, so its migration logs are covered too.
  t = await createTestDatabase({ migrate: false });
  humanDb = await createTestDatabase();
  const db = new URL(t.url);
  // The synthetic password is also the user name, so a hit on it may only be the user name.
  secret(db.password === db.username ? "database password (same as the user name)" : "database password", db.password);
  secret("database URL", t.url);
  secret("second database URL", humanDb.url);
  secret("BETTER_AUTH_SECRET", TEST_SECRET);
  secret("YS_DATA_KEY", TEST_DATA_KEY);

  const port = await freePort();
  baseUrl = `http://localhost:${port}`;
  publicUrl = `http://space.localhost:${port}`;
  child = spawn(process.execPath, [SERVER], {
    env: {
      PATH: process.env.PATH ?? "",
      NODE_ENV: "production",
      PORT: String(port),
      DATABASE_URL: t.url,
      YS_PORT: String(port),
      BETTER_AUTH_SECRET: TEST_SECRET,
      YS_DATA_KEY: TEST_DATA_KEY,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (chunk) => (serverOut.stdout += chunk));
  child.stderr!.on("data", (chunk) => (serverOut.stderr += chunk));

  const deadline = Date.now() + 30_000;
  while (!serverOut.stdout.includes('"event":"server.listening"')) {
    if (child.exitCode !== null) throw new Error(`The server exited early:\n${serverOut.stderr}`);
    if (Date.now() > deadline) throw new Error(`The server did not start:\n${serverOut.stdout}\n${serverOut.stderr}`);
    await sleep(50);
  }
});

afterAll(async () => {
  try {
    // A server killed by a signal has a signalCode and no exitCode; it will not exit again.
    if (child && child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await once(child, "exit");
    }
  } finally {
    await Promise.all([t?.destroy(), humanDb?.destroy()]);
  }
});

interface Reply {
  status: number;
  body: any;
  cookie: string;
  location: string;
}

/** A request as a browser on the public URL behind Caddy would send it. Error bodies are kept for the scan. */
async function call(
  path: string,
  options: { method?: string; body?: unknown; raw?: string; cookie?: string; ip?: string } = {},
): Promise<Reply> {
  const headers = new Headers({ origin: publicUrl, host: new URL(publicUrl).host, "x-forwarded-for": options.ip ?? IP.other });
  const body = options.raw ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
  if (body !== undefined) headers.set("content-type", "application/json");
  if (options.cookie) headers.set("cookie", options.cookie);
  const response = await send(`${baseUrl}${path}`, options.method ?? (body === undefined ? "GET" : "POST"), headers, body);
  const text = await response.text();
  const n = ++responses;
  if (response.status >= 400) publicErrors.push(`${response.status} ${path}: ${text}`);

  const pairs: string[] = [];
  for (const setCookie of response.headers.getSetCookie()) {
    const pair = setCookie.split(";")[0]!;
    const name = pair.slice(0, pair.indexOf("="));
    const value = pair.slice(pair.indexOf("=") + 1);
    if (!value) continue;
    pairs.push(pair);
    secret(`cookie ${name} from response ${n} (${path})`, value);
    // A signed cookie is `<session token>.<signature>`; the token alone also authenticates.
    if (name.endsWith("session_token")) {
      secret(`session token from response ${n} (${path})`, decodeURIComponent(value).split(".")[0]);
    }
  }

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  const location = response.headers.get("location") ?? "";
  return { status: response.status, body: parsed, cookie: pairs.join("; "), location };
}

async function command(
  label: string,
  name: "create-owner" | "reset-link",
  args: string[],
  databaseUrl = t.url,
): Promise<CommandResult> {
  const result = await runCommand(name, args, { databaseUrl, publicUrl });
  commandStderr[label] = result.stderr;
  if (args.includes("--json")) jsonRuns.push(result);
  return result;
}

/** Every value that must stay out of logs and public errors, by label. */
const forbidden = () =>
  new Map<string, string>([...Object.entries(PASSWORDS).map(([k, v]) => [`password ${k}`, v] as const), ...secrets]);

const signIn = (password: string, ip: string) =>
  call("/api/auth/sign-in/username", { body: { username: OWNER.username, password }, ip });

const resetPassword = (token: string, newPassword: string) =>
  call("/api/auth/reset-password", { body: { token, newPassword } });

/** The link line a command prints for a person. */
const linkLine = (stdout: string) => stdout.split("\n").find((line) => line.includes("/reset-password#token="))?.trim();

/** Fails unless the line is one JSON log entry with time, level, and event. */
function expectLogLine(line: string): void {
  let entry: any;
  expect(() => (entry = JSON.parse(line)), line).not.toThrow();
  expect(typeof entry.time, line).toBe("string");
  expect(Number.isNaN(Date.parse(entry.time)), line).toBe(false);
  expect(["debug", "info", "warn", "error"], line).toContain(entry.level);
  expect(typeof entry.event === "string" && entry.event.length > 0, line).toBe(true);
}

const nonEmptyLines = (text: string) => text.split("\n").filter((line) => line.trim() !== "");

describe("logs (cross-cutting scenario 2)", () => {
  it("exercises setup, sign-in, failures, and recovery against the real server", async () => {
    expect((await call("/api/status")).body).toEqual({ owner: false });

    // Setup: create-owner prints a set-password link; the token sets the first password.
    const created = await command("create-owner --json", "create-owner", [
      "--username",
      OWNER.username,
      "--name",
      OWNER.name,
      "--json",
    ]);
    expect(created.code).toBe(0);
    secret("create-owner token", created.json.token);
    secret("create-owner link", created.json.url);

    const again = await command("create-owner (owner exists)", "create-owner", ["--username", OWNER.username, "--name", OWNER.name]);
    expect(again.code).toBe(2);

    // The human-mode success, on the second database.
    const humanOwner = await command(
      "create-owner",
      "create-owner",
      ["--username", OWNER.username, "--name", OWNER.name],
      humanDb.url,
    );
    expect(humanOwner.code).toBe(0);
    const humanOwnerLink = linkLine(humanOwner.stdout);
    expect(humanOwnerLink).toBeDefined();
    secret("create-owner link (human output)", humanOwnerLink);
    secret("create-owner token (human output)", humanOwnerLink?.split("#token=")[1]);

    expect((await resetPassword(created.json.token, PASSWORDS.short)).status).toBe(400);
    expect((await resetPassword(created.json.token, PASSWORDS.first)).status).toBe(200);
    expect((await call("/api/status")).body).toEqual({ owner: true });

    // Sign-in: a wrong password, then the right one.
    expect((await signIn(PASSWORDS.wrong, IP.first)).status).toBe(401);
    const first = await signIn(PASSWORDS.first, IP.first);
    expect(first.status).toBe(200);
    expect(first.cookie).not.toBe("");
    secret("sign-in response token", first.body.token);

    const current = await call("/api/auth/get-session", { cookie: first.cookie });
    expect(current.status).toBe(200);
    expect(current.body.user.username).toBe(OWNER.username);
    secret("get-session token", current.body.session.token);
    expect((await call("/api/auth/organization/list", { cookie: first.cookie })).status).toBe(200);

    // Sign-out, then the old cookie is replayed.
    expect((await call("/api/auth/sign-out", { body: {}, cookie: first.cookie })).status).toBe(200);
    expect((await call("/api/auth/get-session", { cookie: first.cookie })).body).toBeNull();
    expect((await call("/api/auth/organization/list", { cookie: first.cookie })).status).toBe(401);

    // Refused requests: asking for a reset link and signing up over HTTP.
    const reset = await call("/api/auth/request-password-reset", {
      body: { email: `${OWNER.username}@users.invalid`, redirectTo: "/reset-password" },
    });
    expect(reset.status).toBeGreaterThanOrEqual(400);
    const signUp = await call("/api/auth/sign-up/email", {
      body: { email: "visitor@example.com", name: "Visitor", password: PASSWORDS.signUp },
    });
    expect(signUp.status).toBe(400);

    // A second session, which recovery signs out.
    const second = await signIn(PASSWORDS.first, IP.second);
    expect(second.status).toBe(200);
    secret("second sign-in response token", second.body.token);

    // Recovery: one link printed for a person, one as JSON; the JSON one is used.
    const human = await command("reset-link", "reset-link", []);
    expect(human.code).toBe(0);
    const humanLink = linkLine(human.stdout);
    expect(humanLink).toBeDefined();
    secret("reset-link link (human output)", humanLink);
    secret("reset-link token (human output)", humanLink?.split("#token=")[1]);

    const recovery = await command("reset-link --json", "reset-link", ["--json"]);
    expect(recovery.code).toBe(0);
    secret("reset-link token", recovery.json.token);
    secret("reset-link link", recovery.json.url);

    expect((await resetPassword(recovery.json.token, PASSWORDS.recovered)).status).toBe(200);
    expect((await resetPassword(recovery.json.token, PASSWORDS.recovered)).status).toBe(400);
    // The callback route carries the token in the URL path; a used token is redirected with an
    // error and without the token.
    const callback = await call(`/api/auth/reset-password/${recovery.json.token}?callbackURL=%2Freset-password`);
    expect(callback.status).toBe(302);
    expect(callback.location).toContain("error=INVALID_TOKEN");
    expect(callback.location).not.toContain(recovery.json.token);

    expect((await call("/api/auth/get-session", { cookie: second.cookie })).body).toBeNull();
    const recovered = await signIn(PASSWORDS.recovered, IP.recovered);
    expect(recovered.status).toBe(200);
    secret("recovered sign-in response token", recovered.body.token);
    expect((await signIn(PASSWORDS.first, IP.recovered)).status).toBe(401);

    // Repeated failures reach the sign-in limit.
    let limited = 0;
    for (let attempt = 0; attempt < 6 && limited === 0; attempt++) {
      if ((await signIn(PASSWORDS.wrong, IP.limit)).status === 429) limited++;
    }
    expect(limited).toBe(1);

    // Malformed JSON, to Better Auth and to the app's own routes.
    const truncated = `{"username":"${OWNER.username}","password":"${PASSWORDS.malformed}"`;
    const malformedAuth = await call("/api/auth/sign-in/username", { raw: truncated, ip: IP.malformed });
    expect(malformedAuth.status).toBeGreaterThanOrEqual(400);
    expect(malformedAuth.status).toBeLessThan(500);
    const malformedApp = await call("/api/status", { method: "POST", raw: truncated });
    expect(malformedApp).toMatchObject({ status: 400, body: { error: "bad_request" } });

    // 'close' fires once the output pipes are drained, so the shutdown lines are in serverOut.
    child!.kill("SIGTERM");
    const [code] = await once(child!, "close");
    expect(code).toBe(0);
  });

  it("keeps passwords, tokens, links, session values, and configured secrets out of every log", () => {
    const sources: Record<string, string> = {
      "server stdout": serverOut.stdout,
      "server stderr": serverOut.stderr,
      ...Object.fromEntries(Object.entries(commandStderr).map(([label, text]) => [`${label} stderr`, text])),
    };
    const all = forbidden();
    // Every step above ran, so every kind of value is on the list.
    expect([...all.keys()].filter((label) => label.startsWith("session token from"))).toHaveLength(3);
    const required = [
      "create-owner token",
      "create-owner link",
      "create-owner token (human output)",
      "create-owner link (human output)",
      "reset-link token",
      "reset-link link",
      "reset-link token (human output)",
      "reset-link link (human output)",
      "get-session token",
    ];
    expect(required.filter((label) => !all.has(label))).toEqual([]);
    expect(serverOut.stdout).toContain('"event":"server.stopping"');

    const leaks: string[] = [];
    for (const [source, text] of Object.entries(sources)) {
      for (const line of text.split("\n")) {
        for (const [label, value] of all) {
          if (line.includes(value)) leaks.push(`${label} in ${source}: ${line}`);
        }
      }
    }
    expect(leaks).toEqual([]);
  });

  it("writes JSON log lines with time, level, and event", () => {
    // Every line the server writes is a log line.
    const serverLines = nonEmptyLines(`${serverOut.stdout}\n${serverOut.stderr}`);
    expect(serverLines.length).toBeGreaterThan(0);
    for (const line of serverLines) expectLogLine(line);
    // The commands' human-mode messages on stderr are plain text by design; only their log lines are JSON.
    for (const line of nonEmptyLines(Object.values(commandStderr).join("\n"))) {
      if (line.trim().startsWith("{")) expectLogLine(line);
    }
  });

  it("prints only the one JSON object on stdout with --json", () => {
    expect(jsonRuns.length).toBe(2);
    for (const run of jsonRuns) {
      const lines = nonEmptyLines(run.stdout);
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]!)).toEqual(run.json);
      // Log lines may go to stderr (contracts/operator-commands.md), but nothing else.
      for (const line of nonEmptyLines(run.stderr)) expectLogLine(line);
    }
  });

  it("keeps passwords, tokens, and session values out of public error responses", () => {
    expect(publicErrors.length).toBeGreaterThan(5);
    const values = [...forbidden()];
    const leaks = publicErrors.flatMap((error) =>
      values.filter(([, value]) => error.includes(value)).map(([label]) => `${label} in ${error}`),
    );
    expect(leaks).toEqual([]);
  });
});
