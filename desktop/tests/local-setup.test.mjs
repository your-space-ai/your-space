import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createLocalSetup } from "../src/local-setup.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "ys-desktop-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const folder = join(root, "installation");
  const calls = [];
  const app = {
    id: "daemon-aabbcc", name: "local", socket: "/run/my engine.sock", owner: null, ready: true,
    rows: [
      { Name: "local", DockerEndpoint: "unix:///run/my engine.sock", Current: true },
      { Name: "remote", DockerEndpoint: "ssh://private.example", Current: false },
      { Name: "offline", DockerEndpoint: "unix:///run/offline", Current: false },
    ],
    link: "http://space.localhost:8081/reset-password#token=fixture-once",
  };
  const ok = value => ({ code: 0, stdout: JSON.stringify({ ok: true, ...value }) });
  const failed = code => ({ code: 2, stdout: JSON.stringify({ ok: false, error: code, detail: "private server stderr" }) });
  async function run(program, args, { env }) {
    calls.push({ program, args, env });
    assert.equal(env.DOCKER_CONTEXT, undefined);
    assert.equal(env.YS_E2E_RELEASES, undefined);
    assert.equal(env.COMPOSE_PROJECT_NAME, undefined);
    if (program === "docker") {
      if (args[0] === "context") return { code: 0, stdout: app.rows.map(row => JSON.stringify(row)).join("\n") };
      if (args[0] === "info") return { code: 0, stdout: app.id };
    }
    assert.equal(program, "/bundle/your-space");
    assert.ok(env.DOCKER_HOST.startsWith("unix:///"));
    const cwd = args[2];
    const command = args.slice(3);
    switch (command[0]) {
      case "engine":
        return env.DOCKER_HOST.endsWith("offline") ? failed("engine_missing") :
          ok({ engine: { endpoint: env.DOCKER_HOST, os: "linux", arch: "arm64" } });
      case "init":
        assert.deepEqual(command, ["init", "--require-project-check", "--this-machine", "--port", "8081", "--release-dir", "/bundle/release"]);
        await writeFile(join(cwd, "compose.yaml"), "name: your-space\n");
        if (app.initFailure) return failed(app.initFailure);
        return ok({});
      case "start":
        assert.ok(command.includes("--require-project-check"));
        assert.ok(command.includes("--defer-owner"));
        assert.ok(command.includes("--no-open"));
        break;
      case "status":
        assert.ok(command.includes("--require-running"));
        if (app.statusFailure) return failed(app.statusFailure);
        break;
      case "owner":
        app.owner = { name: command[2].slice("--name=".length), username: command[3].slice("--username=".length) };
        if (app.racingUsername) app.owner.username = app.racingUsername;
        if (app.racingClaim) return failed("owner_exists");
        return ok({ url: app.link, token: "do-not-send" });
      default: throw new Error("Unexpected command in fixture");
    }
    return ok({ running: app.ready, setup: { kind: "this-machine", address: app.address ?? "http://space.localhost:8081" },
      services: ["caddy", "server"].map(name => ({ name, state: "running" })), owner: app.owner });
  }
  function service() {
    return createLocalSetup({ folder, cli: { program: "/bundle/your-space" }, releaseDir: "/bundle/release", run,
      env: { HOME: root, DOCKER_CONTEXT: "local", COMPOSE_PROJECT_NAME: "other", YS_E2E_RELEASES: "http://elsewhere.invalid" } });
  }
  return { app, folder, calls, service };
}

test("discovers only available Unix engines and skips remote contexts without contacting them", async t => {
  const { app, calls, service } = await fixture(t);
  const local = service();
  assert.deepEqual(await local.engines(), { engines: [{ name: "local", socket: app.socket, detected: true }], saved: null });
  await assert.rejects(local.start({ engine: "remote" }), { code: "invalid_engine" });
  await assert.rejects(local.start({ engine: "ssh://private.example" }), { code: "invalid_engine" });
  assert.ok(calls.every(c => !c.env.DOCKER_HOST || c.env.DOCKER_HOST.startsWith("unix:///")));
});

test("starts and resumes one managed installation, creating its owner only on explicit request", async t => {
  const { app, folder, calls, service } = await fixture(t);
  const first = service();
  assert.deepEqual(await first.start({ engine: "local", expectedSocket: app.socket }),
    { state: "owner-needed", origin: "http://space.localhost:8081" });
  assert.equal((await stat(join(folder, ".desktop-engine.json"))).mode & 0o777, 0o600);
  const second = service();
  assert.deepEqual((await second.engines()).saved, { name: "local", socket: app.socket });
  assert.deepEqual(await second.createOwner({ name: "Sam Rivera", username: "sam" }),
    { state: "ready", origin: "http://space.localhost:8081", url: app.link });
  assert.deepEqual(await service().start({ engine: app.socket }), { state: "ready", origin: "http://space.localhost:8081" });
  assert.equal(calls.filter(c => c.args[3] === "init").length, 1);
  assert.equal(calls.filter(c => c.args[3] === "owner").length, 1);
  assert.ok(!(await readFile(join(folder, ".desktop-engine.json"), "utf8")).includes("fixture-once"));
  assert.ok(calls.every(c => !JSON.stringify(c.args).includes("fixture-once")));
});

test("refuses stale engine choices, altered daemon identities and an unverified server", async t => {
  const { app, calls, service } = await fixture(t);
  const local = service();
  await assert.rejects(local.start({ engine: "local", expectedSocket: "/run/previous.sock" }), { code: "engine_changed" });
  await local.start({ engine: app.socket });
  app.id = "replacement-daemon";
  await assert.rejects(service().start({ engine: app.socket }), { code: "engine_changed" });
  await assert.rejects(local.createOwner({ name: "Sam", username: "sam" }), { code: "engine_changed" });
  app.id = "daemon-aabbcc";
  app.statusFailure = "another_installation";
  await assert.rejects(local.createOwner({ name: "Sam", username: "sam" }),
    error => error.code === "another_installation" && !error.message.includes("stderr"));
  delete app.statusFailure;
  app.address = "http://other.localhost:8081";
  await assert.rejects(local.createOwner({ name: "Sam", username: "sam" }), { code: "invalid_workspace" });
  assert.ok(calls.every(c => c.args[3] !== "owner"));
});

test("preserves unrelated files, leaves failed initialization retryable and refuses foreign password links", async t => {
  const { app, calls, folder, service } = await fixture(t);
  await mkdir(folder);
  await writeFile(join(folder, ".preserve"), "retain");
  await assert.rejects(service().start({ engine: app.socket }), { code: "folder_not_empty" });
  assert.equal(await readFile(join(folder, ".preserve"), "utf8"), "retain");
  assert.ok(calls.every(c => c.args[3] !== "init"));
  await rm(join(folder, ".preserve"));
  app.initFailure = "checksum_mismatch";
  await assert.rejects(service().start({ engine: app.socket }), { code: "checksum_mismatch" });
  assert.deepEqual(await readdir(folder), []);
  delete app.initFailure;
  await service().start({ engine: app.socket });
  app.link = "https://elsewhere.invalid/reset-password#token=fixture";
  await assert.rejects(service().createOwner({ name: "Sam", username: "sam" }), { code: "invalid_workspace" });
});

test("remembers a manual socket without a named context and resumes after a racing owner claim", async t => {
  const { app, service } = await fixture(t);
  const other = "/run/custom engine.sock";
  await service().start({ engine: other });
  assert.ok((await service().engines()).engines.some(item => item.name === other && item.socket === other));
  app.racingClaim = true;
  assert.deepEqual(await service().createOwner({ name: "Sam", username: "sam" }),
    { state: "ready", origin: "http://space.localhost:8081", url: "http://space.localhost:8081" });
});

test("a different owner claiming during setup returns to recovery", async t => {
  const {app,service} = await fixture(t);
  await service().start({engine:"local",expectedSocket:app.socket});
  app.racingClaim = true;
  app.racingUsername = "another";
  await assert.rejects(service().createOwner({name:"-Sam",username:"sam"}),{code:"invalid_workspace"});
});
