// `your-space app check-update | update` (journey 019, decision 6): the server's update-app command,
// on the machine that runs Your Space. check-update shows what an update of an installed app's kit
// changes and the review's digest; update shows it, asks, and applies that same review, or with
// --review applies only the review an earlier check-update printed. An agent with a shell here drives
// both with --json; an agent's Your Space key can't update apps.
import { Compose } from "../compose.ts";
import { Installation } from "../installation.ts";
import { expectOk, serverCommand } from "../server.ts";
import type { Ui } from "../ui.ts";

export interface Changes {
  compose: { from: { repo: string; path: string; commit: string }; to: { repo: string; path: string; commit: string } } | null;
  images: { ref: string; from: string | null; to: string | null; private: boolean }[];
  settings: { added: string[]; removed: string[] };
  outbound: { added: string[]; removed: string[] };
  services: { added: string[]; removed: string[] };
  interface: { from: { service: string; port: number } | null; to: { service: string; port: number } | null } | null;
}

/** What an update changes, in plain words, one line each. */
export function describeChanges(changes: Changes): string[] {
  const lines: string[] = [];
  if (changes.compose) {
    const { from, to } = changes.compose;
    const moved = from.repo !== to.repo || from.path !== to.path;
    lines.push(
      moved
        ? `Its Compose file moves from ${from.repo}/${from.path} to ${to.repo}/${to.path} at ${to.commit.slice(0, 12)}.`
        : `Its Compose file moves to commit ${to.commit.slice(0, 12)}.`,
    );
  }
  for (const image of changes.images) {
    const named = image.private ? `the private image ${image.ref}` : `the image ${image.ref}`;
    if (image.from === null) lines.push(`It uses ${named}.`);
    else if (image.to === null) lines.push(`It no longer uses the image ${image.ref}.`);
    else lines.push(`${named[0]!.toUpperCase()}${named.slice(1)} moves to a new version.`);
  }
  for (const name of changes.settings.added) lines.push(`A new setting, ${name}.`);
  for (const name of changes.settings.removed) lines.push(`The setting ${name} is no longer used, and is removed.`);
  for (const host of changes.outbound.added) lines.push(`It may reach ${host}.`);
  for (const host of changes.outbound.removed) lines.push(`It no longer reaches ${host}.`);
  for (const service of changes.services.added) lines.push(`A new service, ${service}.`);
  for (const service of changes.services.removed) lines.push(`The service ${service} is removed.`);
  if (changes.interface) {
    const to = changes.interface.to;
    lines.push(to ? `Your Space opens it at ${to.service}, port ${to.port}.` : "It no longer has an interface to open.");
  }
  return lines;
}

async function check(compose: Compose, app: string): Promise<Record<string, unknown>> {
  return expectOk(await serverCommand(compose, "update-app", [app, "--check"]));
}

export async function appCheckUpdate(ui: Ui, workdir: string, app: string): Promise<void> {
  const compose = new Compose(Installation.open(workdir).folder);
  const { ok: _ok, ...review } = await check(compose, app);
  ui.result(review, () => {
    if (review.upToDate) {
      ui.success(`${app} is up to date with its kit.`);
      return;
    }
    ui.note(describeChanges(review.changes as Changes).join("\n"), `An update for ${app} is available`);
    ui.info(`Apply it with: your-space app update ${app}`);
  });
}

export async function appUpdate(ui: Ui, workdir: string, app: string, flags: { review?: string }): Promise<void> {
  const compose = new Compose(Installation.open(workdir).folder);
  let digest = flags.review;
  if (digest === undefined) {
    // The update applied is the one shown here: its digest goes with the apply.
    const review = await check(compose, app);
    if (review.upToDate) {
      ui.result({ name: app, upToDate: true }, () => ui.success(`${app} is up to date with its kit.`));
      return;
    }
    if (!ui.json) ui.note(describeChanges(review.changes as Changes).join("\n"), `An update for ${app}`);
    const go = await ui.confirm({
      message: `Update ${app}? Its data, settings, publishing and agent access stay, and it is rolled back if it doesn't start.`,
      flag: "--yes",
      initial: true,
    });
    if (!go) {
      ui.result({ name: app, updated: false }, () => ui.info("Nothing was changed."));
      return;
    }
    digest = String(review.digest);
  }
  const { ok: _ok, ...done } = expectOk(await serverCommand(compose, "update-app", [app, "--review", digest]));
  ui.result(done, () => ui.success(`${app} is updated and ${String(done.state)}.`));
}
