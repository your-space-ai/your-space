import { createHash } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { parse } from "yaml";
import type { Db } from "../db/client.ts";
import { app, appOutbound, appReplacement, appSetting, installJob, type Kit } from "../db/schema.ts";
import { MAX_FILE_BYTES } from "./github.ts";
import { KitError, kitFromFile } from "./kits.ts";
import { AppError, AppsService, stateFromServices, type AppRow } from "./service.ts";
import { installedGeneration } from "./upgrade-agent-kit.ts";

export interface ReplacementSnapshot {
  repo: string;
  repoId: string;
  commit: string;
  composePath: string;
  composeText: string;
  kitPath: string | null;
  kitText: string | null;
}

type Source = Pick<
  AppRow,
  "sourceUrl" | "repo" | "path" | "ref" | "commit" | "compose" | "kit" | "kitSource" | "images" | "adaptations"
>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
const immutable = /^sha256:[a-f0-9]{64}$/;
const safeFile = /^(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/;

function incompatible(): never {
  throw new AppError(
    409,
    "incompatible_replacement",
    "Keep the installed services, mounts, settings and network configuration. Supply a runnable service image or packed app.",
  );
}

function stale(): never {
  throw new AppError(
    409,
    "replacement_changed",
    "The installed app, its settings, or the preview changed. Review it again.",
  );
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) incompatible();
  return value as Record<string, unknown>;
}

function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
}

const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");

function sourceOf(row: AppRow): Source {
  const { sourceUrl, repo, path, ref, commit, compose, kit, kitSource, images, adaptations } = row;
  return { sourceUrl, repo, path, ref, commit, compose, kit, kitSource, images, adaptations };
}

async function ownerAndApp(tx: Tx, appId: string, owner: string) {
  const result = await tx.execute(sql`select 1 from installation i join member m on m.organization_id=i.workspace_id
    join actor a on a.user_id=m.user_id where i.id=1 and i.state='claimed' and m.role='owner' and a.id=${owner}::uuid`);
  if (!result.rowCount) throw new AppError(403, "owner_required", "Only the workspace owner can replace an app.");
  const [row] = await tx.select().from(app).where(eq(app.id, appId)).for("update");
  if (!row || row.desired === "removed")
    throw new AppError(404, "app_not_found", "This installation is no longer present.");
  if (row.desired !== "running") throw new AppError(409, "app_stopped", "Start the installed app before deploying.");
  const [job] = await tx
    .select({ id: installJob.id })
    .from(installJob)
    .where(and(eq(installJob.appId, row.id), eq(installJob.state, "running")))
    .limit(1);
  if (job) throw new AppError(409, "app_busy", "Wait for the app's current change to finish.");
  return row;
}

async function fingerprint(tx: Tx, row: AppRow, source: Source) {
  const generation = await installedGeneration(tx, row.id);
  const settings = await tx
    .select()
    .from(appSetting)
    .where(eq(appSetting.appId, row.id))
    .orderBy(appSetting.name)
    .for("share");
  const outbound = await tx
    .select()
    .from(appOutbound)
    .where(eq(appOutbound.appId, row.id))
    .orderBy(appOutbound.host)
    .for("share");
  return digest([
    generation,
    source,
    row.name,
    row.interface,
    row.publish,
    row.frame,
    row.pane,
    row.limits,
    row.desired,
    settings,
    outbound,
  ]);
}

function imageName(image: string) {
  const base = image.split("@")[0]!;
  return base.slice(base.lastIndexOf("/") + 1).includes(":") ? base : base + ":latest";
}

// Constrain deltas as well as running them through the normal Compose adapter. A differently
// mounted database or an added sidecar changes what is being managed, even if Compose accepts it.
function describe(text: string) {
  const parsed = object(parse(text));
  const { services, ...project } = parsed;
  const topology: Record<string, unknown> = Object.create(null);
  const artifacts: Record<string, { image: string; command: unknown; entrypoint: unknown; environment: unknown }> =
    Object.create(null);
  for (const [name, raw] of Object.entries(object(services))) {
    const { image, command, entrypoint, environment, ...rest } = object(raw);
    if (
      typeof image !== "string" ||
      !image ||
      image.includes("$") ||
      rest.build !== undefined ||
      rest.extends !== undefined ||
      rest.profiles !== undefined
    )
      incompatible();
    topology[name] = rest;
    artifacts[name] = { image, command, entrypoint, environment };
  }
  if (!Object.keys(topology).length || Object.hasOwn(project, "include")) incompatible();
  return { layout: canonical({ project, services: topology }), artifacts };
}

function checkedKit(row: AppRow, snapshot: ReplacementSnapshot) {
  const previous = row.kit;
  let proposed: Kit | null, kitSource: string | null;
  if (snapshot.kitText === null) {
    proposed = previous ? { ...previous } : null;
    if (proposed) delete proposed.agentReview;
    kitSource = row.kitSource;
  } else {
    try {
      // Co-located kit and Compose were fetched at the same owner-selected immutable commit.
      // A fork may retain its upstream source declaration or a local scaffold may omit it.
      const found = kitFromFile(snapshot.kitText, null);
      const declared = found.kit.source;
      if (
        declared &&
        !(
          (declared.repo.toLowerCase() === snapshot.repo.toLowerCase() && declared.path === snapshot.composePath) ||
          (declared.repo.toLowerCase() === row.repo.toLowerCase() && declared.path === row.path)
        )
      )
        incompatible();
      proposed = found.kit;
      kitSource = found.source;
    } catch (error) {
      // A kit that can't be used says why, such as a source without its commit.
      if (error instanceof KitError) throw new AppError(400, "invalid_kit", error.message);
      incompatible();
    }
  }
  const contract = (kit: Kit | null) => {
    if (!kit) return {};
    const { agentReview, agentAccess, kit: version, source, title, name, ...settings } = kit;
    return settings;
  };
  if (canonical(contract(previous)) !== canonical(contract(proposed))) incompatible();
  return { kit: proposed, kitSource };
}

async function candidateSource(service: AppsService, row: AppRow, input: ReplacementSnapshot) {
  if (
    !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(input.repo) ||
    !/^[1-9][0-9]{0,19}$/.test(input.repoId) ||
    !/^[0-9a-f]{40}$/.test(input.commit) ||
    !safeFile.test(input.composePath) ||
    (input.kitPath !== null && !safeFile.test(input.kitPath)) ||
    (input.kitText === null) !== (input.kitPath === null) ||
    Buffer.byteLength(input.composeText) > MAX_FILE_BYTES
  )
    incompatible();
  let previous: ReturnType<typeof describe>, next: ReturnType<typeof describe>;
  try {
    previous = describe(row.compose);
    next = describe(input.composeText);
  } catch {
    incompatible();
  }
  if (previous.layout !== next.layout) incompatible();
  if (canonical(previous.artifacts) === canonical(next.artifacts)) {
    throw new AppError(
      409,
      "unchanged_artifact",
      "This commit has the same runnable app. Pack the updated page or reference a new immutable image.",
    );
  }
  const spec = await service.specFor(row);
  const pins = { ...spec.pins };
  const requested = new Map<string, string>();
  for (const [name, artifact] of Object.entries(next.artifacts)) {
    const ref = imageName(artifact.image);
    const fixed = artifact.image.split("@")[1];
    const retained = previous.artifacts[name]!.image === artifact.image && row.images[ref]?.digest;
    if (!retained && !fixed) incompatible();
    const pin = fixed ?? retained;
    if (!pin || !immutable.test(pin) || (requested.has(ref) && requested.get(ref) !== pin)) incompatible();
    requested.set(ref, pin);
    pins[ref] = pin;
  }
  // Changing an image spelling without changing its contents does not deploy different code.
  const runnable = (artifacts: typeof next.artifacts, pins: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(artifacts).map(([name, artifact]) => [
        name,
        { ...artifact, image: pins[imageName(artifact.image)] },
      ]),
    );
  if (canonical(runnable(previous.artifacts, spec.pins ?? {})) === canonical(runnable(next.artifacts, pins))) {
    throw new AppError(409, "unchanged_artifact", "The runnable app and image digests are unchanged.");
  }
  const kit = checkedKit(row, input);
  const verifyPins = [...requested].filter(([ref, pin]) => row.images[ref]?.digest !== pin).map(([ref]) => ref);
  const [priorCheck, check] = await Promise.all([
    service.runtime.check(spec),
    service.runtime.check({ ...spec, compose: input.composeText, pins, verifyPins }),
  ]).catch(() => {
    throw new AppError(502, "runtime_check_failed", "The engine could not check the pinned app.");
  });
  if (
    !priorCheck.ok ||
    !check.ok ||
    canonical([...priorCheck.variables].sort((a, b) => a.name.localeCompare(b.name))) !==
      canonical([...check.variables].sort((a, b) => a.name.localeCompare(b.name)))
  )
    incompatible();
  const images: AppRow["images"] = {};
  for (const { ref, digest: pin, runsHere, error } of check.images) {
    if (!pin || !immutable.test(pin) || !runsHere || error || (pins[ref] && pins[ref] !== pin)) incompatible();
    images[ref] = { digest: pin };
  }
  if ([...requested].some(([ref, pin]) => images[ref]?.digest !== pin)) incompatible();
  const source: Source = {
    sourceUrl: "https://github.com/" + input.repo + "/blob/" + input.commit + "/" + input.composePath,
    repo: input.repo,
    path: input.composePath,
    ref: input.commit,
    commit: input.commit,
    compose: input.composeText,
    ...kit,
    images,
    adaptations: check.adaptations,
  };
  return {
    source,
    services: Object.keys(next.artifacts).sort(),
    volumes: [...new Set(check.services.flatMap((service) => service.volumes))].sort(),
  };
}

export async function previewReplacement(
  service: AppsService,
  appId: string,
  ownerActorId: string,
  snapshot: ReplacementSnapshot,
  accountId: string,
) {
  const { row, base } = await service.db.transaction(async (tx) => {
    const row = await ownerAndApp(tx, appId, ownerActorId);
    if (row.state !== "running") stale();
    return { row, base: await fingerprint(tx, row, sourceOf(row)) };
  });
  const { source, services, volumes } = await candidateSource(service, row, snapshot);
  return service.db.transaction(async (tx) => {
    const current = await ownerAndApp(tx, appId, ownerActorId);
    if (current.state !== "running" || (await fingerprint(tx, current, sourceOf(current))) !== base) stale();
    await tx
      .delete(appReplacement)
      .where(and(eq(appReplacement.state, "preview"), lt(appReplacement.expiresAt, new Date())));
    const [preview] = await tx
      .insert(appReplacement)
      .values({
        appId,
        ownerId: ownerActorId,
        repoId: snapshot.repoId,
        baseFingerprint: base,
        original: { ...sourceOf(row), review: { accountId, services, volumes } },
        candidate: source,
        expiresAt: new Date(Date.now() + 30 * 60_000),
      })
      .returning({ id: appReplacement.id });
    return {
      previewId: preview!.id,
      appId,
      repoId: snapshot.repoId,
      repo: source.repo,
      commit: source.commit,
      previousCommit: row.commit || row.sourceUrl,
      images: source.images,
      services,
      volumes,
    };
  });
}

type StoredPreview = typeof appReplacement.$inferSelect;
type Review = { accountId: string; services: string[]; volumes: string[] };

async function readReview(tx: Tx, record: StoredPreview, accountId: string) {
  const { review, ...original } = record.original as Source & { review?: Review };
  const candidate = record.candidate as Source;
  if (review) {
    if (review.accountId !== accountId) return null;
  } else {
    // Older previews predate the recorded account ID. Restore one only when the
    // owner's managed catalog identifies the repository under a single account.
    const accounts = await tx.execute(sql`select account_id from managed_repository
      where owner_id=${record.ownerId} and repo_id=${record.repoId} limit 2`);
    if (accounts.rows.length !== 1 || accounts.rows[0]?.account_id !== accountId) return null;
  }
  return {
    original,
    candidate,
    plan: {
      previewId: record.id,
      appId: record.appId,
      repoId: record.repoId,
      repo: candidate.repo,
      commit: candidate.commit,
      previousCommit: original.commit || original.sourceUrl,
      images: candidate.images,
      services: review?.services ?? Object.keys(describe(candidate.compose).artifacts).sort(),
      volumes: review?.volumes,
    },
  };
}

export async function pendingReplacement(
  service: AppsService,
  appId: string,
  owner: string,
  repoId: string,
  accountId: string,
) {
  return service.db.transaction(async (tx) => {
    const [record] = await tx
      .select()
      .from(appReplacement)
      .where(
        and(
          eq(appReplacement.appId, appId),
          eq(appReplacement.ownerId, owner),
          eq(appReplacement.repoId, repoId),
          eq(appReplacement.state, "applying"),
        ),
      )
      .limit(1);
    if (!record) return { pending: null };
    const row = await ownerAndApp(tx, appId, owner);
    // A running apply may have completed while the lookup waited for the app lock.
    const [latest] = await tx
      .select({ state: appReplacement.state })
      .from(appReplacement)
      .where(eq(appReplacement.id, record.id));
    if (latest?.state !== "applying") return { pending: null };
    const review = await readReview(tx, record, accountId);
    if (!review) return { pending: null };
    if (
      canonical(sourceOf(row)) !== canonical(review.candidate) ||
      (await fingerprint(tx, row, review.original)) !== record.baseFingerprint
    )
      stale();
    return { pending: review.plan };
  });
}

/** Commit the credential/grant retirement before switching any containers. If the server stops between
 * stages, only the same durable preview can resume. The ordinary reconciler leaves that project alone. */
export async function applyReplacement(
  service: AppsService,
  appId: string,
  ownerActorId: string,
  previewId: string,
  expectedRepoId: string,
  accountId: string,
  expectedCommit?: string,
) {
  return service.withAppChange(appId, async () => {
    async function inspect(tx: Tx) {
      const row = await ownerAndApp(tx, appId, ownerActorId);
      const [p] = await tx
        .select()
        .from(appReplacement)
        .where(
          and(
            eq(appReplacement.id, previewId),
            eq(appReplacement.appId, appId),
            eq(appReplacement.ownerId, ownerActorId),
            eq(appReplacement.repoId, expectedRepoId),
          ),
        )
        .for("update");
      if (!p) stale();
      const review = await readReview(tx, p, accountId);
      if (!review || (expectedCommit !== undefined && expectedCommit !== review.candidate.commit)) stale();
      const { original, candidate } = review;
      const appliedSource = p.state === "applying" || p.state === "applied" ? candidate : original;
      if (
        canonical(sourceOf(row)) !== canonical(appliedSource) ||
        (await fingerprint(tx, row, original)) !== p.baseFingerprint
      )
        stale();
      return { row, p, original, candidate };
    }
    const answer = (source: Source) => ({
      appId,
      repoId: expectedRepoId,
      commit: source.commit,
      status: "applied" as const,
    });
    const already = await service.db.transaction(async (tx) => {
      const { row, p, candidate } = await inspect(tx);
      if (p.state === "applied") return answer(candidate);
      if (p.state === "applying") return null;
      if (p.expiresAt <= new Date() || row.state !== "running") stale();
      await tx
        .update(appReplacement)
        .set({ state: "applying", updatedAt: new Date() })
        .where(eq(appReplacement.id, p.id));
      await tx
        .update(app)
        .set({ ...candidate, state: "starting", stateReason: null, updatedAt: new Date() })
        .where(eq(app.id, appId));
      return null;
    });
    if (already) return already;
    const outcome = await service.db.transaction(async (tx) => {
      const { row, p, original, candidate } = await inspect(tx);
      if (p.state === "applied") return answer(candidate);
      if (p.state !== "applying") stale();
      const run = async (source: AppRow) => {
        await service.runtime.apply(await service.specFor(source), () => {});
        const report = (await service.runtime.apps()).find((item) => item.project === "ys-" + row.name);
        const observed = stateFromServices(report?.services ?? []);
        if (!["running", "starting"].includes(observed.state)) throw new Error("The runtime did not start the app.");
        return observed;
      };
      let observed;
      try {
        observed = await run(row);
      } catch {
        try {
          observed = await run({ ...row, ...original });
        } catch {
          await tx
            .update(app)
            .set({
              state: "failed",
              stateReason: "Managed deployment was interrupted. Resume the same deployment to recover.",
              updatedAt: new Date(),
            })
            .where(eq(app.id, appId));
          return "uncertain" as const;
        }
        await tx
          .update(app)
          .set({ ...original, state: observed.state, stateReason: observed.reason, updatedAt: new Date() })
          .where(eq(app.id, appId));
        await tx
          .update(appReplacement)
          .set({ state: "failed", updatedAt: new Date() })
          .where(eq(appReplacement.id, p.id));
        return "restored" as const;
      }
      await tx
        .update(app)
        .set({ state: observed.state, stateReason: observed.reason, updatedAt: new Date() })
        .where(eq(app.id, appId));
      await tx
        .update(appReplacement)
        .set({ state: "applied", updatedAt: new Date() })
        .where(eq(appReplacement.id, p.id));
      return answer(candidate);
    });
    if (outcome === "restored")
      throw new AppError(
        502,
        "previous_artifacts_restored",
        "Deployment failed. The previous app files and image pins were reapplied. App data was retained.",
      );
    if (outcome === "uncertain")
      throw new AppError(
        503,
        "deployment_interrupted",
        "The runtime could not confirm the deployment or recovery. Retry the same deployment.",
      );
    return outcome;
  });
}
