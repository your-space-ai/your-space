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
        if (app.startFailure) return failed(app.startFailure);
        break;
      case "status":
        assert.ok(command.includes("--require-running"));
        if (app.statusFailure) return failed(app.statusFailure);
        break;
      case "upgrade":
        assert.deepEqual(command, ["upgrade", "--yes", "--release-dir", "/bundle/release"]);
        if (app.upgrade) return app.upgrade();
        return { code: 1, stdout: JSON.stringify({ ok: false, error: "usage", message: "unknown command 'upgrade'" }) };
      case "stop":
        assert.deepEqual(command, ["stop", "--yes"]);
        app.stopped = (app.stopped ?? 0) + 1;
        if (app.stopFailure) return failed(app.stopFailure);
        return ok({ stopped: [] });
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
  const versionFile = join(root, "local-version.json");
  function service(version) {
    return createLocalSetup({ folder, cli: { program: "/bundle/your-space" }, releaseDir: "/bundle/release", run,
      version, versionFile: version ? versionFile : undefined,
      env: { HOME: root, DOCKER_CONTEXT: "local", COMPOSE_PROJECT_NAME: "other", YS_E2E_RELEASES: "http://elsewhere.invalid" } });
  }
  return { app, folder, calls, service, versionFile };
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
    error => error.code === "another_installation" && error.message === "This engine already has a Your Space installation " +
      "in another folder. Connect to it at http://space.localhost, followed by its port if it has one, or choose another engine.");
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

test("after the app changes version, upgrades the installation before starting it, once", async t => {
  const { app, calls, service, versionFile } = await fixture(t);
  await service("0.1.0-alpha.1").start({ engine: app.socket });
  assert.deepEqual(JSON.parse(await readFile(versionFile, "utf8")), { version: "0.1.0-alpha.1" });
  assert.equal(calls.filter(c => c.args[3] === "upgrade").length, 0, "a fresh installation is already at the app's version");
  await service("0.1.0-alpha.1").start({ engine: app.socket });
  assert.equal(calls.filter(c => c.args[3] === "upgrade").length, 0);

  app.upgrade = () => ({ code: 0, stdout: JSON.stringify({ ok: true, from: "0.1.0-alpha.1", to: "0.1.0-alpha.2", backup: "/backups/1" }) });
  await service("0.1.0-alpha.2").start({ engine: app.socket });
  const order = calls.map(c => c.args[3]).filter(name => ["upgrade", "start"].includes(name));
  assert.deepEqual(order.slice(-2), ["upgrade", "start"]);
  assert.deepEqual(JSON.parse(await readFile(versionFile, "utf8")), { version: "0.1.0-alpha.2" });
  await service("0.1.0-alpha.2").start({ engine: app.socket });
  assert.equal(calls.filter(c => c.args[3] === "upgrade").length, 1);
  assert.equal(calls.find(c => c.args[3] === "upgrade").args[2], calls.find(c => c.args[3] === "start").args[2]);
});

test("starts as before when the bundled CLI has no upgrade command, and asks again next time", async t => {
  const { app, calls, service, versionFile } = await fixture(t);
  await service().start({ engine: app.socket });
  assert.deepEqual(await service("0.1.0-alpha.2").start({ engine: app.socket }), { state: "owner-needed", origin: "http://space.localhost:8081" });
  await assert.rejects(readFile(versionFile, "utf8"), { code: "ENOENT" });
  await service("0.1.0-alpha.2").start({ engine: app.socket });
  assert.equal(calls.filter(c => c.args[3] === "upgrade").length, 2);

  app.upgrade = () => ({ code: 0, stdout: JSON.stringify({ ok: true, from: "0.1.0-alpha.2", to: "0.1.0-alpha.2", upToDate: true }) });
  await service("0.1.0-alpha.2").start({ engine: app.socket });
  assert.deepEqual(JSON.parse(await readFile(versionFile, "utf8")), { version: "0.1.0-alpha.2" });
});

test("refuses to open an installation newer than the app, and reports other upgrade failures without starting", async t => {
  const { app, calls, service, versionFile } = await fixture(t);
  await service().start({ engine: app.socket });
  const starts = () => calls.filter(c => c.args[3] === "start").length;
  const before = starts();
  app.upgrade = () => ({ code: 2, stdout: JSON.stringify({ ok: false, error: "downgrade_refused", message: "newer" }) });
  await assert.rejects(service("0.1.0-alpha.1").start({ engine: app.socket }),
    error => error.code === "downgrade_refused" && /newer version of Your Space/.test(error.message) &&
      /starts once the app’s update channel has a build at least that new/.test(error.message));
  app.upgrade = () => ({ code: 3, stdout: JSON.stringify({ ok: false, error: "download_failed", detail: "private" }) });
  await assert.rejects(service("0.1.0-alpha.3").start({ engine: app.socket }), { code: "upgrade_failed" });
  app.upgrade = () => ({ code: 2, stdout: JSON.stringify({ ok: false, error: "engine_missing" }) });
  await assert.rejects(service("0.1.0-alpha.3").start({ engine: app.socket }), { code: "engine_missing" });
  app.upgrade = () => ({ code: 4, stdout: "not json" });
  await assert.rejects(service("0.1.0-alpha.3").start({ engine: app.socket }), { code: "upgrade_failed" });
  app.upgrade = () => ({ code: 1, stdout: JSON.stringify({ ok: false, error: "usage", message: "unknown option '--yes'" }) });
  await assert.rejects(service("0.1.0-alpha.3").start({ engine: app.socket }), { code: "upgrade_failed" });
  // The bundled release files failing their check, another command holding the installation and an
  // earlier upgrade killed part way each get their own words; retrying alone fixes none.
  for (const code of ["checksum_mismatch", "installation_busy", "upgrade_interrupted"]) {
    app.upgrade = () => ({ code: 2, stdout: JSON.stringify({ ok: false, error: code, message: "private" }) });
    await assert.rejects(service("0.1.0-alpha.3").start({ engine: app.socket }),
      error => error.code === code && !/internet/.test(error.message) && !error.message.includes("private"));
  }
  assert.equal(starts(), before);
  await assert.rejects(readFile(versionFile, "utf8"), { code: "ENOENT" });
});

test("a failed upgrade says where it left the workspace: the previous version back, tried again next start, or stopped for the owner", async t => {
  const { app, calls, service, versionFile } = await fixture(t);
  await service().start({ engine: app.socket });
  const starts = () => calls.filter(c => c.args[3] === "start").length;
  const before = starts();
  // The previous version's files are back, as upgrade --json reports: the app says so, doesn't open
  // it, and upgrades again at its next start.
  for (const restored of [false, true]) {
    app.upgrade = () => ({ code: 2, stdout: JSON.stringify({ ok: false, error: "start_failed", from: "0.1.0-alpha.1", to: "0.1.0-alpha.2", rolledBack: true, restored, message: "private" }) });
    await assert.rejects(service("0.1.0-alpha.2").start({ engine: app.socket }),
      error => error.code === "upgrade_rolled_back" && /put the previous version back/.test(error.message) &&
        /tries again the next time/.test(error.message) && !error.message.includes("private"));
  }
  // The rollback stopped before the previous files were back, for the owner to finish by hand.
  app.upgrade = () => ({ code: 2, stdout: JSON.stringify({ ok: false, error: "start_failed", rolledBack: false, restored: false, message: "private" }) });
  await assert.rejects(service("0.1.0-alpha.2").start({ engine: app.socket }),
    error => error.code === "upgrade_interrupted" && /doesn’t start it/.test(error.message) && /finish it by hand/.test(error.message));
  // The new version is in place but didn't open: nothing was rolled back, and the next start runs it.
  app.upgrade = () => ({ code: 2, stdout: JSON.stringify({ ok: false, error: "port_in_use", upgraded: true, rolledBack: false, restored: false }) });
  await assert.rejects(service("0.1.0-alpha.2").start({ engine: app.socket }), { code: "upgrade_failed" });
  assert.equal(starts(), before);
  await assert.rejects(readFile(versionFile, "utf8"), { code: "ENOENT" });
  // Each upgrade ran: a failure records no version, so the next start tries again.
  assert.equal(calls.filter(c => c.args[3] === "upgrade").length, 4);
});

test("start refuses an installation an earlier upgrade left part way, or one another command is changing", async t => {
  const { app, service } = await fixture(t);
  await service().start({ engine: app.socket });
  app.startFailure = "upgrade_interrupted";
  await assert.rejects(service().start({ engine: app.socket }),
    error => error.code === "upgrade_interrupted" && /doesn’t start it/.test(error.message) && /upgrade guide/.test(error.message));
  app.startFailure = "installation_busy";
  await assert.rejects(service().start({ engine: app.socket }),
    error => error.code === "installation_busy" && /Wait for it to finish/.test(error.message));
});

test("a failed upgrade may have started the workspace again, so quitting still stops it", async t => {
  const { app, service } = await fixture(t);
  await service().start({ engine: app.socket });
  const local = service("0.1.0-alpha.2");
  // For example, the new version didn't become ready and the previous one was started again.
  app.upgrade = () => ({ code: 2, stdout: JSON.stringify({ ok: false, error: "start_failed", rolledBack: true, restored: false }) });
  await assert.rejects(local.start({ engine: app.socket }), { code: "upgrade_rolled_back" });
  assert.equal(local.mayBeRunning(), true);
  await local.stop();
  assert.equal(app.stopped, 1);
  assert.equal(local.mayBeRunning(), false);
});

test("an upgrade refused before it changed anything leaves the workspace as started as it was", async t => {
  const { app, service, versionFile } = await fixture(t);
  await service().start({ engine: app.socket });
  for (const error of ["downgrade_refused", "installation_busy", "upgrade_interrupted", "checksum_mismatch", "download_failed"]) {
    const local = service("0.1.0-alpha.2");
    app.upgrade = () => {
      // Counted as started while it runs, in case the app quits meanwhile.
      assert.equal(local.mayBeRunning(), true);
      return { code: 2, stdout: JSON.stringify({ ok: false, error, message: "private" }) };
    };
    await assert.rejects(local.start({ engine: app.socket }));
    assert.equal(local.mayBeRunning(), false);
    assert.deepEqual(await local.stop(), { stopped: [] });
  }
  assert.equal(app.stopped, undefined);

  // A workspace this process already started stays counted as started.
  const local = service("0.1.0-alpha.2");
  app.upgrade = () => ({ code: 0, stdout: JSON.stringify({ ok: true, from: "0.1.0-alpha.1", to: "0.1.0-alpha.2", backup: "/backups/1" }) });
  await local.start({ engine: app.socket });
  await rm(versionFile);
  app.upgrade = () => ({ code: 2, stdout: JSON.stringify({ ok: false, error: "installation_busy" }) });
  await assert.rejects(local.start({ engine: app.socket }), { code: "installation_busy" });
  assert.equal(local.mayBeRunning(), true);
});

test("stops only an installation this process started, on its saved engine, after a start in progress", async t => {
  const { app, calls, service } = await fixture(t);
  const local = service();
  assert.equal(local.mayBeRunning(), false);
  assert.deepEqual(await local.stop(), { stopped: [] });
  assert.equal(app.stopped, undefined);

  const starting = local.start({ engine: "local" });
  const stopping = local.stop({ timeout: 5000 });
  await starting;
  assert.equal(local.mayBeRunning(), true);
  await stopping;
  assert.equal(app.stopped, 1);
  const stop = calls.find(c => c.args[3] === "stop");
  assert.equal(stop.env.DOCKER_HOST, "unix://" + app.socket);
  assert.equal(calls.indexOf(stop) > calls.findIndex(c => c.args[3] === "status"), true);
  assert.equal(local.mayBeRunning(), false);

  await local.start({ engine: "local" });
  app.id = "replacement-daemon";
  const before = app.stopped;
  await assert.rejects(local.stop(), { code: "engine_changed" });
  assert.equal(app.stopped, before, "never stops a same-named project on another daemon");
  app.id = "daemon-aabbcc";
  app.stopFailure = "engine_missing";
  await assert.rejects(local.stop(), { code: "engine_missing" });
  assert.equal(local.mayBeRunning(), true, "a failed stop leaves the workspace possibly running");
  assert.equal(service().mayBeRunning(), false, "another process never started it");
});
