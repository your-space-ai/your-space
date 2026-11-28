// Journey 019, slice 1: an installed app is checked for an update at its kit's link, and the reviewed
// update is applied in place. The app keeps its ID, kept settings, publish settings, owner-approved
// hosts and agent credentials; removed settings and the kit hosts the kit dropped go. An update applies
// only the candidate it reviewed, while the app still runs the kit the review was made against.
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decrypt } from "../src/apps/settings.ts";
import { app, appOutbound, appSetting, event, installJob } from "../src/db/schema.ts";
import { GithubConnection } from "../src/github-connection.ts";
import { restoreInterruptedUpdates, snapshotOf } from "../src/apps/rollback.ts";
import { runCommand } from "./helpers/commands.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { TEST_DATA_KEY as DATA_KEY } from "./helpers/env.ts";
import { createOwnerWithPassword, OWNER } from "./helpers/owner.ts";
import { COMMIT, fakeGithub, fakeGithubAccounts, FakeRuntime } from "./helpers/runtime.ts";
import { cookieHeader, startServer, type TestServer } from "./helpers/server.ts";

const NEXT = "a".repeat(40);
// A synthetic token with GitHub's prefix, far too short to be a real one.
const TOKEN = "github_pat_ys_fixture_contents_0001";
const LATER = "b".repeat(40);
const LINK = "https://github.com/ys-fixtures/catalog/blob/main/apps/notes.yaml";
const COMPOSE = `services:\n  web:\n    image: traefik/whoami:latest\n`;
const kit = (commit: string, more = "") =>
  `kit: 1\nsource: { repo: ys-fixtures/notes, path: compose.yaml, commit: ${commit} }\nname: notes\ninterface: { service: web, port: 80 }\n${more}`;

describe("updating an installed app in place", () => {
  let t: TestDatabase;
  let server: TestServer;
  let runtime: FakeRuntime;
  let cookie: string;
  let head: string;
  let files: Record<string, string>;
  let answerExtra: (at: string) => Response | undefined;
  /** Repositories GitHub shows only to the connection's token. */
  let hidden: Record<string, string[]>;
  let calls: { url: string; authorization: string | null }[];

  beforeEach(async () => {
    t = await createTestDatabase();
    head = COMMIT;
    answerExtra = () => undefined;
    hidden = {};
    calls = [];
    files = {
      [`ys-fixtures/notes@${COMMIT}/compose.yaml`]: COMPOSE,
      [`ys-fixtures/notes@${NEXT}/compose.yaml`]: COMPOSE,
      [`ys-fixtures/catalog@${COMMIT}/apps/notes.yaml`]: kit(COMMIT, "env:\n  GREETING: hello\n  OLD: kept\noutbound: [api.one.test]\n"),
    };
    // `main` is at `head`, which a test moves to publish a new commit of the kits repository.
    const accounts = fakeGithubAccounts(new Map([[TOKEN, "ys-fixture-owner"]]));
    const github: typeof fetch = async (input, init) => {
      if (String(input).endsWith("/user")) return accounts.fetch(input, init);
      return fakeGithub(files, {
        private: hidden,
        calls: calls as never,
        answer: (url, token) => {
          if (hidden["ys-fixtures/catalog"] && token !== TOKEN && url.pathname.startsWith("/repos/ys-fixtures/catalog/")) return undefined;
          const at = url.pathname.replace("/repos/ys-fixtures/catalog/", "");
          if (at === "commits/main" || at === "commits/HEAD") return new Response(head);
          if (at === "branches/main") return Response.json({ name: "main" });
          return answerExtra(at);
        },
      })(input, init);
    };
    runtime = new FakeRuntime();
    runtime.variables = [];
    server = await startServer(t.db, { apps: { runtime, fetch: github } });
    await createOwnerWithPassword(t.db, OWNER, server.publicUrl);
    const login = await server.request("/api/auth/sign-in/username", { method: "POST", body: JSON.stringify({ username: OWNER.username, password: OWNER.password }) });
    cookie = cookieHeader(login);
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await server?.close();
    await t?.destroy();
  });

  const api = async (path: string, body: unknown, method = "POST") => {
    const response = await server.request(path, { method, headers: { cookie }, body: JSON.stringify(body) });
    const text = await response.text();
    return { status: response.status, text, json: text ? JSON.parse(text) : null };
  };
  async function settle(): Promise<void> {
    for (let i = 0; i < 500; i++) {
      const running = await t.db.select({ id: installJob.id }).from(installJob).where(eq(installJob.state, "running"));
      if (running.length === 0) return;
      await new Promise((r) => setTimeout(r, 20));
    }
    throw new Error("The job didn't finish.");
  }
  async function install(link = LINK): Promise<string> {
    const review = await api("/api/kits/preview", { kitUrl: link });
    expect(review.status, review.text).toBe(200);
    expect((await api("/api/apps", { previewId: review.json.previewId })).status).toBe(202);
    await settle();
    return (await t.db.select().from(app).where(eq(app.name, "notes")))[0]!.id;
  }
  /** Publishes a new commit of the kits repository's `main` with this kit. */
  function publish(commit: string, text: string): void {
    files[`ys-fixtures/catalog@${commit}/apps/notes.yaml`] = text;
    head = commit;
  }
  const settings = async (id: string) =>
    Object.fromEntries(
      (await t.db.select().from(appSetting).where(eq(appSetting.appId, id))).map((s) => [s.name, s.value === null ? null : decrypt(DATA_KEY, s.value)]),
    );
  const hosts = async (id: string) =>
    (await t.db.select({ host: appOutbound.host, source: appOutbound.source }).from(appOutbound).where(eq(appOutbound.appId, id))).sort((a, b) => a.host.localeCompare(b.host));

  it("stores the kit's link at install, and finds nothing new when only other files changed", async () => {
    const id = await install();
    expect((await t.db.select({ kitLink: app.kitLink }).from(app).where(eq(app.id, id)))[0]!.kitLink).toBe(LINK);
    // A new commit whose kit file is the same, as when only a README changed.
    publish(LATER, files[`ys-fixtures/catalog@${COMMIT}/apps/notes.yaml`]!);
    const check = await api("/api/apps/notes/update/check", {});
    expect(check.status, check.text).toBe(200);
    expect(check.json.upToDate).toBe(true);
    expect((await api("/api/apps/notes/update", { previewId: check.json.previewId })).json.error).toBe("up_to_date");
  });

  it("applies a newer kit in place, keeping the app's data, settings, publish settings, hosts and agent credentials", async () => {
    const id = await install();
    // The owner changes a setting, approves a host of their own and publishes the app.
    expect((await api("/api/apps/notes/settings", { values: { GREETING: "hi from the owner" } }, "PUT")).status).toBe(202);
    await settle();
    await t.db.insert(appOutbound).values({ appId: id, host: "owner.example.test", source: "owner", approvedBy: (await t.db.select().from(app))[0]!.installedBy });
    await t.db.update(app).set({ publish: { port: 8123, bind: "127.0.0.1", link: null } }).where(eq(app.id, id));
    // An agent credential the owner bound (spec 018) must survive the update.
    await t.pool.query("insert into agent_binding(app_id, enabled_roles, kit_digest, revision, credential_revision) values ($1, '{}', '', 1, 1)", [id]);
    await t.pool.query("insert into agent_credential(app_id, name, credential) values ($1, 'records', 'sealed')", [id]);

    publish(NEXT, kit(NEXT, "env:\n  GREETING: hello\n  ADDED: fresh\noutbound: [api.two.test]\n"));
    const check = await api("/api/apps/notes/update/check", {});
    expect(check.status, check.text).toBe(200);
    expect(check.json).toMatchObject({
      upToDate: false,
      ok: true,
      link: LINK,
      changes: {
        kit: { from: `https://github.com/ys-fixtures/catalog/blob/${COMMIT}/apps/notes.yaml`, to: `https://github.com/ys-fixtures/catalog/blob/${NEXT}/apps/notes.yaml` },
        compose: { from: { repo: "ys-fixtures/notes", commit: COMMIT }, to: { repo: "ys-fixtures/notes", commit: NEXT } },
        settings: { added: ["ADDED"], removed: ["OLD"] },
        outbound: { added: ["api.two.test"], removed: ["api.one.test"] },
        interface: null,
      },
    });
    expect(check.json.digest).toMatch(/^[0-9a-f]{64}$/);

    const applied = await api("/api/apps/notes/update", { previewId: check.json.previewId, digest: check.json.digest });
    expect(applied.status, applied.text).toBe(202);
    await settle();
    const [row] = await t.db.select().from(app).where(eq(app.id, id));
    expect(row).toMatchObject({ commit: NEXT, kitSource: `https://github.com/ys-fixtures/catalog/blob/${NEXT}/apps/notes.yaml`, kitLink: LINK, state: "running" });
    expect(row!.publish).toEqual({ port: 8123, bind: "127.0.0.1", link: null });
    expect(await settings(id)).toEqual({ GREETING: "hi from the owner", ADDED: "fresh" });
    expect(await hosts(id)).toEqual([
      { host: "api.two.test", source: "kit" },
      { host: "owner.example.test", source: "owner" },
    ]);
    expect((await t.pool.query("select name from agent_credential where app_id=$1", [id])).rows).toEqual([{ name: "records" }]);
    const [job] = await t.db.select().from(installJob).where(eq(installJob.id, applied.json.jobId));
    expect(job).toMatchObject({ kind: "update", state: "succeeded" });
    expect((await t.db.select({ type: event.type }).from(event).where(eq(event.subjectAppId, id))).map((e) => e.type)).toContain("app.updated");
    // The app was started again with the new kit's hosts.
    expect([...runtime.calls.filter((c) => c.method === "apply").at(-1)!.spec!.egress!].sort()).toEqual(["api.two.test", "owner.example.test"]);
  });

  it("lets a kit's own value follow the kit unless the owner changed it", async () => {
    const id = await install();
    publish(NEXT, kit(NEXT, "env:\n  GREETING: hello again\n  OLD: kept\noutbound: [api.one.test]\n"));
    const check = await api("/api/apps/notes/update/check", {});
    // The review says so.
    expect(check.json.changes.settings).toEqual({ added: [], removed: [], changed: ["GREETING"] });
    expect((await api("/api/apps/notes/update", { previewId: check.json.previewId })).status).toBe(202);
    await settle();
    expect(await settings(id)).toEqual({ GREETING: "hello again", OLD: "kept" });
  });

  it("follows the default branch for a tag deleted since, without reading the tag", async () => {
    let tagged = true;
    answerExtra = (at) => (at === "commits/v1" && tagged ? new Response(COMMIT) : undefined);
    await install("https://github.com/ys-fixtures/catalog/blob/v1/apps/notes.yaml");
    tagged = false;
    publish(NEXT, kit(NEXT, "env:\n  GREETING: hello\n"));
    const check = await api("/api/apps/notes/update/check", {});
    expect(check.json, check.text).toMatchObject({ upToDate: false, link: "https://github.com/ys-fixtures/catalog/blob/HEAD/apps/notes.yaml" });
  });

  it("checks an image a setting given at apply completes, which the review held as a placeholder", async () => {
    await install();
    runtime.images = (spec) => [
      { ref: `traefik/whoami:${spec.env.IMAGE_TAG ?? "placeholder"}`, registry: "docker.io", digest: spec.env.IMAGE_TAG ? "sha256:eee" : undefined, runsHere: true, platforms: ["linux/amd64"] },
    ];
    publish(NEXT, kit(NEXT, "env:\n  GREETING: hello\n  IMAGE_TAG: { ask: true, secret: false }\n"));
    const check = await api("/api/apps/notes/update/check", {});
    const applied = await api("/api/apps/notes/update", { previewId: check.json.previewId, settings: { IMAGE_TAG: "v1.10" } });
    expect(applied.status, applied.text).toBe(202);
    await settle();
    expect((await t.db.select({ images: app.images }).from(app))[0]!.images).toEqual({ "traefik/whoami:v1.10": { digest: "sha256:eee" } });
  });

  it("refuses a review made before the app's publishing changed, and keeps a kit host the owner approved", async () => {
    const id = await install();
    publish(NEXT, kit(NEXT, "env:\n  GREETING: hello\n  OLD: kept\n"));
    const stale = await api("/api/apps/notes/update/check", {});
    await t.db.update(app).set({ publish: { port: 8123, bind: "127.0.0.1", link: "https://notes.example.test" } }).where(eq(app.id, id));
    expect((await api("/api/apps/notes/update", { previewId: stale.json.previewId })).json.error).toBe("update_changed");
    // The owner approves a host the kit lists too; the update drops it from the kit, and it stays.
    expect((await api("/api/apps/notes/outbound", { host: "api.one.test" })).status).toBe(202);
    await settle();
    const fresh = await api("/api/apps/notes/update/check", {});
    expect(fresh.json.changes.outbound.removed).toEqual([]);
    expect((await api("/api/apps/notes/update", { previewId: fresh.json.previewId })).status).toBe(202);
    await settle();
    expect(await hosts(id)).toEqual([{ host: "api.one.test", source: "owner" }]);
  });

  it("applies only the candidate it reviewed, and refuses one made against a kit the app no longer runs", async () => {
    await install();
    publish(NEXT, kit(NEXT, "env:\n  GREETING: hello\n"));
    const first = await api("/api/apps/notes/update/check", {});
    const second = await api("/api/apps/notes/update/check", {});
    // A digest from another review is refused.
    expect((await api("/api/apps/notes/update", { previewId: first.json.previewId, digest: "0".repeat(64) })).json.error).toBe("update_changed");
    // The branch moves on after the review; applying still applies the commit reviewed.
    publish(LATER, kit(NEXT, "env:\n  GREETING: later\n"));
    expect((await api("/api/apps/notes/update", { previewId: second.json.previewId })).status).toBe(202);
    await settle();
    expect((await t.db.select({ kitSource: app.kitSource }).from(app))[0]!.kitSource).toContain(NEXT);
    // The first review was made against the kit the app ran before.
    expect((await api("/api/apps/notes/update", { previewId: first.json.previewId })).json.error).toBe("update_changed");
  });

  it("follows the default branch for a kit installed from a commit, or before links were kept", async () => {
    const id = await install(`https://github.com/ys-fixtures/catalog/blob/${COMMIT}/apps/notes.yaml`);
    publish(NEXT, kit(NEXT, "env:\n  GREETING: hello\n"));
    const check = await api("/api/apps/notes/update/check", {});
    expect(check.json, check.text).toMatchObject({ upToDate: false, link: "https://github.com/ys-fixtures/catalog/blob/HEAD/apps/notes.yaml" });
    expect((await api("/api/apps/notes/update", { previewId: check.json.previewId })).status).toBe(202);
    await settle();
    expect((await t.db.select({ kitLink: app.kitLink }).from(app))[0]!.kitLink).toBe("https://github.com/ys-fixtures/catalog/blob/HEAD/apps/notes.yaml");

    // An app installed before links were kept is checked at its pinned kit's file on the default branch.
    await t.db.update(app).set({ kitLink: null }).where(eq(app.id, id));
    publish(LATER, kit(NEXT, "env:\n  GREETING: later\n"));
    expect((await api("/api/apps/notes/update/check", {})).json.upToDate).toBe(false);
    // One installed from a kit file on this machine has no kit on GitHub to check.
    await t.db.update(app).set({ kitSource: `sha256:${"0".repeat(64)}` }).where(eq(app.id, id));
    expect((await api("/api/apps/notes/update/check", {})).json.error).toBe("no_kit_link");
  });

  it("doesn't count an image tag that names another digest now as an update", async () => {
    await install();
    runtime.images = () => [{ ref: "traefik/whoami:latest", registry: "docker.io", digest: "sha256:ccc", runsHere: true, platforms: ["linux/amd64"] }];
    expect((await api("/api/apps/notes/update/check", {})).json.upToDate).toBe(true);
  });

  it("signs in for the app's private images while the update pulls them (FR-005)", async () => {
    await install();
    const credential = { registry: "ghcr.io", username: "ys-fixture-owner", secret: "ghp_ys_fixture_image_0001" };
    vi.spyOn(GithubConnection.prototype, "signingIn").mockResolvedValue({ state: "ready", credential, worked: async () => {}, refused: async () => {} } as never);
    runtime.images = () => [{ ref: "ghcr.io/ys-fixtures/notes:latest", registry: "ghcr.io", digest: "sha256:ddd", runsHere: true, platforms: ["linux/amd64"], private: true }];
    publish(NEXT, kit(NEXT, "env:\n  GREETING: hello\n"));
    const check = await api("/api/apps/notes/update/check", {});
    expect(check.json.changes.images).toContainEqual({ ref: "ghcr.io/ys-fixtures/notes:latest", from: null, to: "sha256:ddd", private: true });
    expect((await api("/api/apps/notes/update", { previewId: check.json.previewId })).status).toBe(202);
    await settle();
    expect(runtime.calls.filter((c) => c.method === "apply").at(-1)!.spec!.registryCredentials).toEqual([{ ...credential, images: ["ghcr.io/ys-fixtures/notes:latest"] }]);
  });

  it("refuses a review made before the owner changed a setting, and a second apply while one runs", async () => {
    await install();
    publish(NEXT, kit(NEXT, "env:\n  GREETING: hello\n  OLD: kept\n"));
    const stale = await api("/api/apps/notes/update/check", {});
    expect((await api("/api/apps/notes/settings", { values: { GREETING: "changed after the review" } }, "PUT")).status).toBe(202);
    await settle();
    expect((await api("/api/apps/notes/update", { previewId: stale.json.previewId })).json.error).toBe("update_changed");

    const first = await api("/api/apps/notes/update/check", {});
    const second = await api("/api/apps/notes/update/check", {});
    const [a, b] = await Promise.all([
      api("/api/apps/notes/update", { previewId: first.json.previewId }),
      api("/api/apps/notes/update", { previewId: second.json.previewId }),
    ]);
    expect([a.status, b.status].sort()).toEqual([202, 409]);
    await settle();
  });

  it("checks the update with the published link's address, as the app runs with it", async () => {
    const id = await install();
    await t.db.update(app).set({ publish: { port: 8123, bind: "127.0.0.1", link: "https://notes.example.test" } }).where(eq(app.id, id));
    publish(NEXT, kit(NEXT, "env:\n  GREETING: hello\n  HOST: { derive: app_host }\n"));
    expect((await api("/api/apps/notes/update/check", {})).status).toBe(200);
    expect(runtime.calls.filter((c) => c.method === "check").at(-1)!.spec!.env.HOST).toBe("notes.example.test");
  });

  it("finds nothing new in an unchanged kit with agent access, limits and a title, and says when only those change", async () => {
    const rich = (commit: string, api: string) =>
      `kit: 2\nsource: { repo: ys-fixtures/notes, path: compose.yaml, commit: ${commit} }\nname: notes\ntitle: Notes\ninterface: { service: web, port: 80 }\n` +
      `env:\n  GREETING: hello\n  OLD: kept\noutbound: [api.one.test]\nlimits:\n  web: { memory: 512M, cpus: 0.5 }\n` +
      `agentAccess:\n  api: ${api}\n  credential: { binding: service, inject: { location: header, name: Authorization, scheme: Bearer } }\n`;
    files[`ys-fixtures/catalog@${COMMIT}/apps/notes.yaml`] = rich(COMMIT, "/rest");
    await install();
    publish(LATER, rich(COMMIT, "/rest"));
    expect((await api("/api/apps/notes/update/check", {})).json.upToDate).toBe(true);
    publish(NEXT, rich(COMMIT, "/api"));
    const check = await api("/api/apps/notes/update/check", {});
    expect(check.json).toMatchObject({ upToDate: false, changes: { compose: null, images: [], kitFields: ["agentAccess"] } });
  });

  it("updates a kit in a private repository through the GitHub connection", async () => {
    hidden = { "ys-fixtures/catalog": [TOKEN] };
    expect((await api("/api/github", { token: TOKEN }, "PUT")).status).toBe(200);
    const id = await install();
    expect((await t.db.select({ provenance: app.provenance }).from(app).where(eq(app.id, id)))[0]!.provenance).toMatchObject({ kit: { read: "connection" } });
    publish(NEXT, kit(NEXT, "env:\n  GREETING: hello\n  OLD: kept\n"));
    calls.length = 0;
    const check = await api("/api/apps/notes/update/check", {});
    expect(check.json, check.text).toMatchObject({ upToDate: false, kit: { read: { read: "connection", login: "ys-fixture-owner" } } });
    // Whether its ref is a branch is asked with the connection's token too.
    expect(calls.find((c) => c.url.endsWith("/repos/ys-fixtures/catalog/branches/main"))?.authorization).toBe(`Bearer ${TOKEN}`);
    expect((await api("/api/apps/notes/update", { previewId: check.json.previewId })).status).toBe(202);
    await settle();
    expect((await t.db.select({ commit: app.commit }).from(app).where(eq(app.id, id)))[0]!.commit).toBe(NEXT);
  });

  it("lets only the signed-in owner check for and apply an update, never an agent's key", async () => {
    await install();
    for (const path of ["/api/apps/notes/update/check", "/api/apps/notes/update"]) {
      expect((await server.request(path, { method: "POST", body: "{}" })).status).toBe(401);
      expect((await server.request(path, { method: "POST", body: "{}", headers: { authorization: "Bearer ys_agent_fixture_key" } })).status).toBe(401);
      expect((await server.request(path, { method: "POST", body: "{}", headers: { cookie, origin: "https://other.example" } })).status).toBe(403);
    }
  });

  describe("rollback (decision 3)", () => {
    const failing = () => kit(NEXT, "env:\n  GREETING: hello\n  ADDED: fresh\noutbound: [api.two.test]\n");
    async function update(): Promise<{ jobId: string }> {
      const check = await api("/api/apps/notes/update/check", {});
      expect(check.json.upToDate, check.text).toBe(false);
      const applied = await api("/api/apps/notes/update", { previewId: check.json.previewId });
      expect(applied.status, applied.text).toBe(202);
      await settle();
      return applied.json;
    }
    async function expectRolledBack(id: string, jobId: string) {
      const [row] = await t.db.select().from(app).where(eq(app.id, id));
      expect(row).toMatchObject({ commit: COMMIT, kitSource: `https://github.com/ys-fixtures/catalog/blob/${COMMIT}/apps/notes.yaml`, kitLink: LINK });
      expect(await settings(id)).toEqual({ GREETING: "hello", OLD: "kept" });
      expect(await hosts(id)).toEqual([{ host: "api.one.test", source: "kit" }]);
      const [job] = await t.db.select().from(installJob).where(eq(installJob.id, jobId));
      expect(job).toMatchObject({ kind: "update", state: "failed", rollback: null });
      expect(job!.error).toContain("The update didn't start and was rolled back");
      expect((await t.db.select({ type: event.type }).from(event).where(eq(event.subjectAppId, id))).map((e) => e.type)).toContain("app.update_rolled_back");
      return { row: row!, job: job! };
    }

    it("puts the app back and starts it again when the update's start fails", async () => {
      const id = await install();
      runtime.failApplyWhen = (spec) => (spec.env.ADDED ? "web exited with code 1" : undefined);
      publish(NEXT, failing());
      const { jobId } = await update();
      const { row } = await expectRolledBack(id, jobId);
      expect(row.state).toBe("running");
      expect(row.stateReason).toContain("web exited with code 1");
      expect(runtime.calls.filter((c) => c.method === "apply").at(-1)!.spec!.env.ADDED).toBeUndefined();
    });

    it("puts the app back when it started but doesn't keep running", async () => {
      const id = await install();
      runtime.servicesAfterApply = (spec) => (spec.env.ADDED ? [{ name: "web", role: "app", state: "exited", exitCode: 1 }] : undefined);
      publish(NEXT, failing());
      const { jobId } = await update();
      const { row, job } = await expectRolledBack(id, jobId);
      expect(job.error).toContain("web stopped (exit code 1)");
      expect(row.state).toBe("running");
    });

    it("shows the app as failed, on the kit it ran before, when the rollback's start fails too", async () => {
      const id = await install();
      runtime.failApplyWhen = () => "the engine is gone";
      publish(NEXT, failing());
      const { jobId } = await update();
      const { row, job } = await expectRolledBack(id, jobId);
      expect(row.state).toBe("failed");
      expect(job.error).toContain("Starting it again with the kit it ran before failed too: the engine is gone");
      // No service of the update keeps running.
      expect(runtime.calls.at(-1)).toMatchObject({ method: "down", project: "ys-notes" });
    });

    it("stops the app when the kit it ran before doesn't keep running either", async () => {
      const id = await install();
      runtime.servicesAfterApply = () => [{ name: "web", role: "app", state: "exited", exitCode: 1 }];
      publish(NEXT, failing());
      const { jobId } = await update();
      const { row, job } = await expectRolledBack(id, jobId);
      expect(row.state).toBe("failed");
      expect(job.error).not.toContain("Rolled back: the app runs");
      expect(job.steps.map((step) => step.message)).not.toContain("Rolled back: the app runs the kit it ran before.");
      expect(runtime.calls.at(-1)).toMatchObject({ method: "down" });
    });

    it("rolls back an update whose app service exits cleanly, or is still starting when the wait ends", async () => {
      const id = await install();
      runtime.servicesAfterApply = (spec) => (spec.env.ADDED ? [{ name: "web", role: "app", state: "exited", exitCode: 0 }] : undefined);
      publish(NEXT, failing());
      const clean = await expectRolledBack(id, (await update()).jobId);
      expect(clean.job.error).toContain("web stopped.");
      runtime.servicesAfterApply = (spec) => (spec.env.ADDED ? [{ name: "web", role: "app", state: "running", health: "starting" }] : undefined);
      const slow = await expectRolledBack(id, (await update()).jobId);
      expect(slow.job.error).toContain("still starting");
    });

    it("keeps the date each kit host was approved through a rollback", async () => {
      const id = await install();
      const approved = new Date("2026-01-02T03:04:05Z");
      await t.db.update(appOutbound).set({ createdAt: approved }).where(eq(appOutbound.appId, id));
      runtime.failApplyWhen = (spec) => (spec.env.ADDED ? "web exited with code 1" : undefined);
      publish(NEXT, failing());
      await update();
      expect((await t.db.select({ createdAt: appOutbound.createdAt }).from(appOutbound).where(eq(appOutbound.appId, id)))[0]!.createdAt).toEqual(approved);
    });

    it("puts back an update a restart interrupted", async () => {
      const id = await install();
      const before = (await t.db.select().from(app).where(eq(app.id, id)))[0]!;
      const snapshot = await t.db.transaction((tx) => snapshotOf(tx, before, before.installedBy));
      await t.db.update(app).set({ commit: NEXT, state: "starting" }).where(eq(app.id, id));
      await t.db.delete(appSetting).where(eq(appSetting.appId, id));
      const [job] = await t.db.insert(installJob).values({ appId: id, kind: "update", rollback: snapshot }).returning();
      const restored = await restoreInterruptedUpdates(t.db);
      expect(restored).toEqual([id]);
      const [row] = await t.db.select().from(app).where(eq(app.id, id));
      expect(row).toMatchObject({ commit: COMMIT, state: "starting" });
      expect(await settings(id)).toEqual({ GREETING: "hello", OLD: "kept" });
      expect((await t.db.select().from(installJob).where(eq(installJob.id, job!.id)))[0]).toMatchObject({ state: "failed", rollback: null });
      // The server's start then applies the kit it put back, replacing the update's containers.
      await server.apps!.recoverJobs(restored);
      await settle();
      expect(runtime.calls.filter((c) => c.method === "apply").at(-1)!.spec!.env).toMatchObject({ GREETING: "hello", OLD: "kept" });
      expect((await t.db.select({ state: app.state }).from(app).where(eq(app.id, id)))[0]!.state).toBe("running");
    });

    it("puts back, at the next start, an update whose rollback couldn't finish", async () => {
      const id = await install();
      const before = (await t.db.select().from(app).where(eq(app.id, id)))[0]!;
      const snapshot = await t.db.transaction((tx) => snapshotOf(tx, before, before.installedBy));
      await t.db.update(app).set({ commit: NEXT, state: "failed" }).where(eq(app.id, id));
      await t.db.insert(installJob).values({ appId: id, kind: "update", state: "failed", rollback: snapshot });
      expect(await restoreInterruptedUpdates(t.db)).toEqual([id]);
      expect((await t.db.select({ commit: app.commit }).from(app).where(eq(app.id, id)))[0]!.commit).toBe(COMMIT);
    });

    it("keeps an update that runs, and clears what it kept to roll back", async () => {
      await install();
      publish(NEXT, failing());
      const { jobId } = await update();
      expect((await t.db.select().from(installJob).where(eq(installJob.id, jobId)))[0]).toMatchObject({ state: "succeeded", rollback: null });
    });
  });

  it("refuses a kit for another app", async () => {
    await install();
    publish(NEXT, kit(NEXT).replace("name: notes", "name: other"));
    const r = await api("/api/apps/notes/update/check", {});
    expect(r.json.error, r.text).toBe("other_app");
  });
});

describe("the update-app command", () => {
  let t: TestDatabase;
  beforeEach(async () => {
    t = await createTestDatabase();
  });
  afterEach(async () => {
    await t?.destroy();
  });

  it("says how to use it, and what's wrong with an app it can't check", async () => {
    const usage = await runCommand("update-app", ["--json"], { databaseUrl: t.url });
    expect(usage.code).toBe(1);
    expect(usage.json).toMatchObject({ ok: false, error: "usage" });
    expect((await runCommand("update-app", ["notes", "--check", "--review", "x", "--json"], { databaseUrl: t.url })).json.error).toBe("usage");
    const missing = await runCommand("update-app", ["notes", "--check", "--json"], { databaseUrl: t.url });
    expect(missing.code).toBe(2);
    expect(missing.json).toMatchObject({ ok: false });
  });
});

