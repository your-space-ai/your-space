import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";

const messages = {
  docker_missing: "Install a Docker-compatible engine and its Docker CLI, then try again.",
  engine_missing: "Start your local Docker engine, then try again.",
  engine_unsupported: "Choose a local Unix socket running Linux Docker Engine 28.3.3 or later on arm64 or amd64.",
  compose_missing: "Install Docker Compose 2.26.0 or later, then try again.",
  permission_denied: "Your Mac user needs permission to access this Docker socket.",
  invalid_engine: "Choose a local Docker context or enter an absolute Unix socket path.",
  engine_changed: "This installation belongs to another Docker engine. Start the originally selected engine to resume it.",
  another_installation: "This engine already has a Your Space installation in another folder. Connect to it at http://space.localhost, followed by its port if it has one, or choose another engine.",
  folder_not_empty: "Your Space found other files in its installation folder. Move them aside before setting up here.",
  download_failed: "The desktop installation files are missing. Install the matching Your Space desktop build and retry.",
  checksum_mismatch: "The packaged installation files failed verification. Install a fresh copy of this desktop build.",
  not_running: "The local workspace is stopped. Start it again to continue.",
  start_failed: "The local workspace could not start. Check that Docker can pull and start this build’s images.",
  storage_unavailable: "Your Space cannot read its database. Check that the local stack is running, then retry.",
  lost_secrets: "This installation is missing its secrets. Use the installation guide to recover it.",
  port_in_use: "The local port is in use. Free the port and retry.",
  owner_exists: "This workspace already has an owner. Reopen it to sign in.",
  invalid_input: "Enter a name of up to 100 characters and a username of 3–30 letters, digits, underscores, or periods.",
  invalid_workspace: "The selected installation did not report a running local Your Space workspace.",
  busy: "A local setup operation is already in progress.",
  downgrade_refused: "This workspace runs a newer version of Your Space than this app, so the app doesn’t start it. It starts once the app’s update channel has a build at least that new and the app has updated to it.",
  installation_busy: "Another Your Space command is changing the local workspace. Wait for it to finish, then retry.",
  upgrade_interrupted: "An upgrade of the local workspace stopped part way, so Your Space doesn’t start it. Use the upgrade guide to finish it by hand, then retry.",
  upgrade_rolled_back: "Your Space couldn’t upgrade the local workspace to this version, so it put the previous version back and didn’t open it. It tries again the next time it starts the workspace.",
  upgrade_failed: "Your Space could not upgrade the local workspace to this version. Check your internet connection and Docker, then retry.",
  unexpected: "The local setup command could not finish. Check Docker and retry.",
};

// Failures `upgrade` can report in the launcher's own words; any other becomes upgrade_failed.
const upgradeCodes = new Set(["docker_missing", "engine_missing", "engine_unsupported", "compose_missing", "permission_denied",
  "checksum_mismatch", "downgrade_refused", "installation_busy", "upgrade_interrupted"]);
// Failures `upgrade` reports before it stops, changes or starts anything.
const upgradeRefusals = new Set(["usage", "installation_busy", "upgrade_interrupted", "version_unknown",
  "downgrade_refused", "checksum_mismatch", "download_failed"]);
const minutes = 60_000;

export function localSetupError(code) {
  const safe = Object.hasOwn(messages, code) ? code : "unexpected";
  return Object.assign(new Error(messages[safe]), { code: safe });
}

// Capture operator JSON only in this process. Docker's stderr or the CLI's raw output can contain secrets.
function runProcess(program, args, { env, timeout = 30_000, signal }) {
  return new Promise((accept, reject) => {
    execFile(program, args, { env, shell: false, timeout, signal, maxBuffer: 4 * 1024 * 1024 }, (error, stdout) => {
      if (error && typeof error.code !== "number") {
        reject(localSetupError(error.code === "ENOENT" && program === "docker" ? "docker_missing" : "unexpected"));
      } else accept({ code: error?.code ?? 0, stdout });
    });
  });
}

function socketPath(value) {
  const path = typeof value === "string" && value.startsWith("unix://") ? value.slice(7) : value;
  return typeof path === "string" && path.startsWith("/") && !path.startsWith("//") &&
    !/[\x00-\x1f\x7f]/.test(path) && path.length < 4096 ? path : null;
}

function localOrigin(summary) {
  let url;
  try { url = new URL(summary.setup.address); } catch { throw localSetupError("invalid_workspace"); }
  if (!summary.running || summary.setup.kind !== "this-machine" || url.protocol !== "http:" ||
      url.hostname !== "space.localhost" || url.href !== url.origin + "/" ||
      !["server", "caddy"].every(name => summary.services?.some(s => s.name === name && s.state === "running"))) {
    throw localSetupError("invalid_workspace");
  }
  return url.origin;
}

// `version` is the app's own, which its bundled CLI shares. After the app changes version, the next
// start first runs `upgrade` so the installation matches it; `versionFile` records the last match.
export function createLocalSetup({ folder, cli, releaseDir, version, versionFile, run = runProcess, env = process.env }) {
  if (!isAbsolute(folder) || !cli || !isAbsolute(cli.program)) throw localSetupError("unexpected");
  const stateFile = ".desktop-engine.json";
  const installation = resolve(folder);
  // GUI launches on macOS often omit Homebrew and the Docker Desktop CLI from PATH.
  const base = { PATH: [env.PATH, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin",
    "/Applications/Docker.app/Contents/Resources/bin", env.HOME && join(env.HOME, ".docker/bin"),
    env.HOME && join(env.HOME, ".orbstack/bin")].filter(Boolean).join(":") };
  for (const key of ["HOME", "USER", "TMPDIR", "LANG", "DOCKER_CONFIG"]) if (env[key]) base[key] = env[key];
  let busy = false;
  let pending = Promise.resolve();
  // Whether this process has asked the CLI to start the installation since it last stopped it.
  let started = false;

  async function exclusive(fn) {
    if (busy) throw localSetupError("busy");
    busy = true;
    const work = fn();
    pending = work.catch(() => {});
    try { return await work; } finally { busy = false; }
  }

  async function invoke(socket, workdir, args, options = {}) {
    const result = await run(cli.program, [...(cli.args ?? []), "--json", "--workdir", workdir, ...args], {
      env: { ...base, DOCKER_HOST: "unix://" + socket },
      timeout: options.timeout ?? (["start", "upgrade"].includes(args[0]) ? 10 * minutes : 30_000),
      signal: options.signal,
    });
    let value;
    try { value = JSON.parse(result.stdout); } catch { value = undefined; }
    return { code: result.code, value };
  }

  async function command(socket, workdir, args, options) {
    const { code, value } = await invoke(socket, workdir, args, options);
    if (!value) throw localSetupError("unexpected");
    if (code !== 0 || value.ok !== true) throw localSetupError(value.error);
    return value;
  }

  async function recordedVersion() {
    try { return JSON.parse(await readFile(versionFile, "utf8")).version; } catch { return undefined; }
  }

  async function recordVersion() {
    if (!versionFile) return;
    await mkdir(dirname(versionFile), { recursive: true, mode: 0o700 });
    const temporary = versionFile + "." + process.pid + ".tmp";
    try {
      await writeFile(temporary, JSON.stringify({ version }), { mode: 0o600 });
      await rename(temporary, versionFile);
    } finally { await rm(temporary, { force: true }); }
  }

  // Brings an existing installation to the app's version: the shared `upgrade` contract with the CLI,
  // from the release files bundled with the app, as `init` uses them.
  async function upgrade(socket) {
    if (!version || !versionFile || await recordedVersion() === version) return;
    // `upgrade` starts the installation, and one that fails after changing it starts the previous
    // version again, so the installation counts as started while it runs. A refusal leaves it as it was.
    const before = started;
    started = true;
    const bundled = releaseDir && isAbsolute(releaseDir) ? ["--release-dir", releaseDir] : [];
    const { code, value } = await invoke(socket, installation, ["upgrade", "--yes", ...bundled]);
    if (value?.ok === true && code === 0) {
      if (value.to === version) await recordVersion();
      return;
    }
    if (upgradeRefusals.has(value?.error)) started = before;
    // A CLI built before `upgrade` existed answers with a usage error. Start as before and retry next time.
    if (value?.error === "usage" && /unknown command/i.test(String(value.message))) return;
    // Where a failed upgrade left the installation (2026-11-23): the previous version's files back, so
    // the next start tries again; or not, so the rollback stopped for the owner to finish by hand, and
    // the CLI refuses to start it until then.
    if (value?.rolledBack === true) throw localSetupError("upgrade_rolled_back");
    if (value?.rolledBack === false && value.upgraded !== true) throw localSetupError("upgrade_interrupted");
    throw localSetupError(upgradeCodes.has(value?.error) ? value.error : "upgrade_failed");
  }

  async function contexts() {
    const result = await run("docker", ["context", "ls", "--format", "{{json .}}"], { env: base, timeout: 7000 });
    if (result.code !== 0) throw localSetupError("engine_missing");
    let rows;
    try { rows = result.stdout.trim().split("\n").filter(Boolean).map(value => JSON.parse(value)); }
    catch { throw localSetupError("invalid_engine"); }
    const local = [];
    for (const row of rows) {
      const socket = row.DockerEndpoint?.startsWith("unix:///") && socketPath(row.DockerEndpoint);
      if (!socket || typeof row.Name !== "string") continue;
      const detected = env.DOCKER_CONTEXT ? row.Name === env.DOCKER_CONTEXT :
        env.DOCKER_HOST ? socket === socketPath(env.DOCKER_HOST) : row.Current === true || row.Current === "*";
      local.push({ name: row.Name, socket, detected });
    }
    const custom = !env.DOCKER_CONTEXT && socketPath(env.DOCKER_HOST);
    if (custom && !local.some(item => item.socket === custom)) local.push({ name: custom, socket: custom, detected: true });
    return local;
  }

  async function record() {
    try {
      if (!(await lstat(installation)).isDirectory()) throw localSetupError("folder_not_empty");
      const path = join(installation, stateFile);
      if (!(await lstat(path)).isFile()) throw localSetupError("engine_changed");
      const saved = JSON.parse(await readFile(path, "utf8"));
      if (!socketPath(saved.socket) || typeof saved.name !== "string" || !saved.id) throw localSetupError("engine_changed");
      return saved;
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw localSetupError(error.code === "folder_not_empty" ? error.code : "engine_changed");
    }
  }

  async function preflight(socket) {
    const { engine } = await command(socket, installation, ["engine", "check"]);
    if (engine?.endpoint !== "unix://" + socket || engine.os !== "linux" || !["arm64", "amd64"].includes(engine.arch)) {
      throw localSetupError("engine_unsupported");
    }
    const result = await run("docker", ["info", "--format", "{{.ID}}"], {
      env: { ...base, DOCKER_HOST: "unix://" + socket }, timeout: 7000,
    });
    const id = result.stdout.trim();
    if (result.code !== 0 || !/^[a-zA-Z0-9:-]{8,128}$/.test(id)) throw localSetupError("engine_missing");
    return id;
  }

  async function engines() {
    const state = await record();
    const saved = state ? { name: state.name, socket: state.socket } : null;
    let reason;
    const engines = [];
    try {
      const checked = new Map();
      const candidates = await contexts();
      if (saved && socketPath(saved.name) && !candidates.some(candidate => candidate.name === saved.name)) {
        candidates.push({ ...saved, detected: false });
      }
      for (const candidate of candidates) {
        if (!checked.has(candidate.socket)) {
          try { checked.set(candidate.socket, await preflight(candidate.socket)); }
          catch (error) { checked.set(candidate.socket, localSetupError(error.code)); }
        }
        const result = checked.get(candidate.socket);
        if (result instanceof Error) {
          if (!reason || candidate.detected) reason = result;
        } else if (state && state.socket === candidate.socket && state.id !== result) {
          reason = localSetupError("engine_changed");
        } else engines.push(candidate);
      }
    } catch (error) { reason = localSetupError(error.code); }
    const issue = reason ?? localSetupError("engine_missing");
    return { engines, saved, ...(!engines.length ? { problem: { code: issue.code, message: issue.message } } : {}) };
  }

  async function selected(input) {
    let socket = socketPath(input);
    if (!socket) {
      if (typeof input !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(input)) throw localSetupError("invalid_engine");
      socket = (await contexts()).find(c => c.name === input)?.socket;
      if (!socket) throw localSetupError("invalid_engine");
    }
    return { name: input, socket, id: await preflight(socket) };
  }

  async function install(engine) {
    if (!releaseDir || !isAbsolute(releaseDir)) throw localSetupError("download_failed");
    let entries;
    try { entries = await readdir(installation); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (entries?.length) throw localSetupError("folder_not_empty");
    await mkdir(dirname(installation), { recursive: true, mode: 0o700 });
    const stage = await mkdtemp(join(dirname(installation), ".your-space-init-"));
    try {
      await command(engine.socket, stage, ["init", "--require-project-check", "--this-machine", "--port", "8081", "--release-dir", releaseDir]);
      await writeFile(join(stage, stateFile), JSON.stringify(engine), { mode: 0o600, flag: "wx" });
      await rename(stage, installation);
    } finally { await rm(stage, { recursive: true, force: true }); }
    if (version) await recordVersion();
  }

  function sameEngine(saved, requested) {
    if (saved.socket !== requested.socket || saved.id !== requested.id) throw localSetupError("engine_changed");
  }

  return {
    engines,
    start({ engine, expectedSocket }) {
      return exclusive(async () => {
        const saved = await record();
        const pick = await selected(engine);
        if (expectedSocket !== undefined && expectedSocket !== pick.socket) throw localSetupError("engine_changed");
        if (saved) {
          sameEngine(saved, pick);
          await upgrade(pick.socket);
        } else await install(pick);
        started = true;
        const result = await command(pick.socket, installation, ["start", "--require-project-check", "--defer-owner", "--no-open", "--yes"]);
        const origin = localOrigin(result);
        const status = await command(pick.socket, installation, ["status", "--require-running"]);
        if (localOrigin(status) !== origin || Boolean(status.owner) !== Boolean(result.owner)) throw localSetupError("invalid_workspace");
        return { state: status.owner ? "ready" : "owner-needed", origin };
      });
    },
    // True once this process has started the installation, until stop() succeeds. Quitting uses it to
    // decide synchronously whether there is a workspace to stop.
    mayBeRunning: () => started,
    // Stops the installation this process started, with the engine it was set up on. It waits for a
    // start in progress to finish first, so the two never run at once; the caller bounds the wait.
    async stop({ timeout = 2 * minutes, signal } = {}) {
      while (busy) await pending;
      if (!started) return { stopped: [] };
      const saved = await record();
      if (!saved) throw localSetupError("invalid_workspace");
      // Like start, act only on the daemon the installation was set up on.
      sameEngine(saved, { socket: saved.socket, id: await preflight(saved.socket) });
      const result = await command(saved.socket, installation, ["stop", "--yes"], { timeout, signal });
      started = false;
      return result;
    },
    createOwner({ name, username }) {
      return exclusive(async () => {
        if (typeof name !== "string" || !name.trim() || name.length > 100 || /[\x00-\x1f\x7f]/.test(name) ||
            typeof username !== "string" || !/^[a-zA-Z0-9_.]{3,30}$/.test(username)) throw localSetupError("invalid_input");
        const saved = await record();
        if (!saved) throw localSetupError("invalid_workspace");
        sameEngine(saved, { socket: saved.socket, id: await preflight(saved.socket) });
        const status = await command(saved.socket, installation, ["status", "--require-running"]);
        const origin = localOrigin(status);
        if (status.owner) return { state: "ready", origin, url: origin };
        // The public name and username are operator command arguments. Passwords are entered only on the workspace page.
        let result;
        try {
          result = await command(saved.socket, installation, ["owner", "create", "--name=" + name.trim(), "--username=" + username]);
        } catch (error) {
          if (error.code !== "owner_exists") throw error;
          const fresh = await command(saved.socket, installation, ["status", "--require-running"]);
          if (fresh.owner?.username?.toLowerCase() !== username.toLowerCase() || localOrigin(fresh) !== origin) throw localSetupError("invalid_workspace");
          return { state: "ready", origin, url: origin };
        }
        let link;
        try { link = new URL(result.url); } catch { throw localSetupError("invalid_workspace"); }
        if (link.origin !== origin || link.username || link.password || link.pathname !== "/reset-password" ||
            link.search || !/^#token=[A-Za-z0-9_%.-]+$/.test(link.hash)) throw localSetupError("invalid_workspace");
        return { state: "ready", origin, url: link.href };
      });
    },
  };
}
