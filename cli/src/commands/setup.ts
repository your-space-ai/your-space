import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, link, lstat, mkdir, mkdtemp, open, readdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Compose } from "../compose.ts";
import { CliError } from "../errors.ts";
import { Installation, RELEASE_FILES } from "../installation.ts";
import { showOwner } from "../server.ts";
import { checkPort } from "../setup.ts";
import type { Ui } from "../ui.ts";
import { prepareInstallation } from "./init.ts";
import { createOwner, startInstallation } from "./start.ts";

export interface WorkspaceSetupFlags {
  port?: string;
  releaseDir?: string;
  ownerName?: string;
  ownerUsername?: string;
}

const handoffName = ".your-space-owner-link";
const stagingPrefix = ".your-space-setup-";

function hasCode(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException)?.code === code;
}

// Publish each staged release file without replacing an existing file. Matching
// bytes can be left by an interrupted or simultaneous setup of this workspace.
async function installFile(source: string, target: string): Promise<void> {
  if (!(await lstat(source)).isFile()) throw new CliError("checksum_mismatch", "The release contains an unexpected file type.");
  try {
    await link(source, target);
  } catch (error) {
    if (!hasCode(error, "EEXIST")) throw error;
    const existing = await lstat(target);
    if (!existing.isFile() || !(await readFile(target)).equals(await readFile(source))) {
      throw new CliError("folder_not_empty", "This folder contains different installation files. Use an empty folder or manage the existing workspace explicitly.");
    }
  }
}

async function initialize(ui: Ui, folder: string, flags: WorkspaceSetupFlags): Promise<void> {
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const entries = await readdir(folder);
  if (entries.some(name => !RELEASE_FILES.includes(name) && name !== ".env" && !name.startsWith(stagingPrefix))) {
    throw new CliError("folder_not_empty", "Run setup in a new, empty folder, or point --workdir at an existing Your Space installation.");
  }
  const stage = await mkdtemp(join(folder, stagingPrefix));
  try {
    await prepareInstallation(ui, stage, { thisMachine: true, port: flags.port, releaseDir: flags.releaseDir, requireProjectCheck: true });
    await chmod(join(stage, ".env"), 0o600);
    const modes = join(folder, "modes");
    await mkdir(modes, { recursive: true });
    if (!(await lstat(modes)).isDirectory()) throw new CliError("folder_not_empty", "The installation's modes path must be a local directory.");
    for (const name of await readdir(join(stage, "modes"))) await installFile(join(stage, "modes", name), join(modes, name));
    // compose.yaml is the last file. Its presence marks this setup as runnable.
    for (const name of ["env.example", ".env", "stack.yaml", "compose.yaml"]) await installFile(join(stage, name), join(folder, name));
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

async function createHandoff(ui: Ui, compose: Compose, flags: WorkspaceSetupFlags, address: string) {
  const path = join(compose.folder, handoffName);
  if (await showOwner(compose)) return { owner: "present", handoffFile: await existingHandoff(path) };
  if (await existingHandoff(path)) {
    throw new CliError("invalid_input", "An owner handoff file is already present without a matching owner. Move it aside before creating a new owner.");
  }
  const temporary = join(compose.folder, stagingPrefix + randomUUID());
  const output = await open(temporary, "wx", 0o600);
  try {
    const handoff = await createOwner(ui, compose, {
      ownerName: flags.ownerName ?? "Owner", ownerUsername: flags.ownerUsername ?? "owner", open: false,
    });
    const url = new URL(handoff.url);
    if (url.origin !== new URL(address).origin || url.pathname !== "/reset-password" || url.search ||
        url.username || url.password || !/^#token=[^&#\s]+$/u.test(url.hash)) {
      throw new Error("Unexpected owner handoff");
    }
    await output.writeFile(url.href + "\n");
    await output.sync();
    await link(temporary, path);
    return { owner: "created", handoffFile: path };
  } catch (error) {
    if (error instanceof CliError && error.code === "owner_exists") return { owner: "present", handoffFile: await existingHandoff(path) };
    if (error instanceof CliError && error.code === "invalid_input") throw new CliError("invalid_input", "The server rejected the owner details. Check the name and username, then retry.");
    // A server or filesystem diagnostic could contain the one-use link.
    throw new CliError("storage_unavailable", "Could not save the owner handoff. Re-run setup to check the owner. If an owner exists without a usable link, use the local owner recovery command privately.");
  } finally {
    await output.close();
    await rm(temporary, { force: true });
  }
}

// Never return a link encoded by someone else, a symlink or a readable-by-others file.
async function existingHandoff(path: string): Promise<string | null> {
  try {
    const state = await lstat(path);
    if (!state.isFile() || state.uid !== process.getuid?.() || (state.mode & 0o077)) {
      throw new CliError("invalid_input", "The owner handoff path must be a private regular file owned by this operator.");
    }
    return path;
  } catch (error) {
    if (hasCode(error, "ENOENT")) return null;
    throw error;
  }
}

export async function setupWorkspace(ui: Ui, workdir: string, flags: WorkspaceSetupFlags): Promise<void> {
  const folder = resolve(workdir);
  if (flags.port !== undefined && checkPort(flags.port)) throw new CliError("invalid_input", "Choose a valid local port from 1 to 65535.");
  const existing = existsSync(folder) && Installation.isOne(folder);
  if (!existing) await initialize(ui, folder, flags);
  const installation = Installation.open(folder);
  const current = installation.setup();
  if (existing && flags.port && (current.kind === "domain" || current.port !== Number(flags.port))) {
    throw new CliError("invalid_input", "This installation already has a different port. Use your-space configure to change it.");
  }
  const summary = await startInstallation(ui, folder, { open: false, deferOwner: true, requireProjectCheck: true });
  if (!summary.running) throw new CliError("not_running", "Your Space did not become ready. Inspect your-space status and logs, then retry setup.");
  const handoff = await createHandoff(ui, new Compose(folder), flags, summary.setup.address);
  const result = { folder, version: summary.version, workspaceUrl: summary.setup.address, running: true, ...handoff };
  ui.result(result, () => {
    ui.note(result.workspaceUrl, "Open Your Space");
    if (handoff.handoffFile) ui.note(handoff.handoffFile, "Private owner handoff file");
  });
}
