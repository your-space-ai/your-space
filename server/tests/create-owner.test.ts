// T023: the create-owner command (User Story 1; contracts/operator-commands.md).
import pg from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createCommandAuth, storedIdentifier } from "../src/auth.ts";
import { createOwner } from "../src/owner/create-owner.ts";
import { account, member, organization, user, verification } from "../src/db/auth-schema.ts";
import { actor, event, installation } from "../src/db/schema.ts";
import { runCommand } from "./helpers/commands.ts";
import { createTestDatabase, type TestDatabase } from "./helpers/db.ts";
import { PUBLIC_URL, TEST_SECRET } from "./helpers/env.ts";
import { counts } from "./helpers/state.ts";

let t: TestDatabase;
beforeEach(async () => {
  t = await createTestDatabase();
});
afterEach(async () => {
  await t.destroy();
});

const create = (args: string[]) => runCommand("create-owner", args, { databaseUrl: t.url });
const VALID = ["--username", "Sam.Rivera", "--name", "Sam Rivera"];
const WITH_EMAIL = [...VALID, "--email", "Sam@Example.COM"];

describe("create-owner", () => {
  it("creates exactly one account, workspace, owner membership, actor, event, and claim", async () => {
    const before = Date.now();
    const result = await create([...VALID, "--json"]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);

    // --json output matches the contract exactly.
    expect(Object.keys(result.json).sort()).toEqual(["email", "expiresAt", "ok", "token", "url", "username"]);
    expect(result.json.ok).toBe(true);
    // Stored in lower case. With no --email, the account holds a reserved address it never reports.
    expect(result.json.username).toBe("sam.rivera");
    expect(result.json.email).toBeNull();
    expect(result.json.token).toMatch(/^[A-Za-z0-9]{24}$/);
    expect(result.json.url).toBe(`${PUBLIC_URL}/reset-password#token=${result.json.token}`);
    expect(result.json.expiresAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    const expires = Date.parse(result.json.expiresAt);
    expect(expires).toBeGreaterThanOrEqual(before + 29 * 60_000);
    expect(expires).toBeLessThanOrEqual(Date.now() + 30 * 60_000);

    expect(await counts(t.db)).toMatchObject({ users: 1, organizations: 1, members: 1, sessions: 0, actors: 2, events: 1 });

    const [owner] = await t.db.select().from(user);
    expect(owner).toMatchObject({ name: "Sam Rivera", username: "sam.rivera", email: "sam.rivera@users.invalid", emailVerified: false });

    const [workspace] = await t.db.select().from(organization);
    expect(workspace!.name).toBe("Sam Rivera's space");

    const [membership] = await t.db.select().from(member);
    expect(membership).toMatchObject({ userId: owner!.id, organizationId: workspace!.id, role: "owner" });

    const [claim] = await t.db.select().from(installation);
    expect(claim).toMatchObject({ id: 1, state: "claimed", workspaceId: workspace!.id });
    expect(claim!.claimedAt).toBeInstanceOf(Date);

    const actors = await t.db.select().from(actor);
    const operator = actors.find((a) => a.kind === "operator")!;
    const human = actors.find((a) => a.kind === "human")!;
    expect(human.userId).toBe(owner!.id);

    const [created] = await t.db.select().from(event);
    expect(created).toMatchObject({ type: "owner.created", actorId: operator.id, subjectUserId: owner!.id });

    // The account starts with a random scrypt-hashed password that was never shown.
    const [credential] = await t.db.select().from(account).where(eq(account.userId, owner!.id));
    expect(credential!.providerId).toBe("credential");
    expect(credential!.password).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/);
    expect(result.stdout).not.toContain(credential!.password!);

    // The link is Better Auth's reset token, valid for 30 minutes.
    const tokens = await t.db.select().from(verification);
    expect(tokens).toHaveLength(1);
    // Stored only as a hash, so a copy of the database can't open the link.
    expect(tokens[0]!.identifier).toBe(storedIdentifier(`reset-password:${result.json.token}`));
    expect(JSON.stringify(tokens)).not.toContain(result.json.token);
  });

  it("prints the human-readable output by default", async () => {
    const result = await create(VALID);
    expect(result.code).toBe(0);
    const lines = result.stdout.trim().split("\n");
    expect(lines[0]).toBe("Owner created: Sam Rivera (username sam.rivera)");
    expect(lines[1]).toMatch(/^Set your password here \(expires \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ, works once\):$/);
    expect(lines[2]).toMatch(new RegExp(`^${PUBLIC_URL}/reset-password#token=[A-Za-z0-9]{24}$`));
    expect(lines[3]).toBe("If it expires, run: docker compose exec server reset-link");
  });

  it("exits 2 with owner_exists when run again, and changes nothing", async () => {
    expect((await create([...VALID, "--json"])).code).toBe(0);
    const before = await counts(t.db);

    for (const args of [VALID, ["--username", "someone", "--name", "Someone Else"]]) {
      const again = await create([...args, "--json"]);
      expect(again.code).toBe(2);
      expect(again.json).toEqual({ ok: false, error: "owner_exists", message: "This installation already has an owner." });
    }
    const human = await create(VALID);
    expect(human.code).toBe(2);
    expect(human.stdout).toBe("");
    expect(human.stderr).toContain("already has an owner");

    expect(await counts(t.db)).toEqual(before);
    expect(await t.db.select({ username: user.username }).from(user)).toEqual([{ username: "sam.rivera" }]);
  });

  it.each([
    [["--username", "sam", "--name", "Sam", "--email", "not-an-email"], "email"],
    // Valid for a browser's email field, refused by Better Auth's rule, so refused up front.
    [["--username", "sam", "--name", "Sam", "--email", "sam!x@example.com"], "email"],
    [["--username", "sam", "--name", "Sam", "--email", "sam@example.c"], "email"],
    [["--username", "sam", "--name", "Sam", "--email", "sam..x@example.com"], "email"],
    [["--username", "sam", "--name", "Sam", "--email", `${"a".repeat(250)}@x.co`], "email"],
    [["--username", "sam", "--name", "Sam", "--email", ""], "email"],
    // The reserved placeholder domain can't be anyone's own address.
    [["--username", "sam", "--name", "Sam", "--email", "sam@users.invalid"], "email"],
    [["--username", "sa", "--name", "Sam"], "username"],
    [["--username", "s".repeat(31), "--name", "Sam"], "username"],
    [["--username", "sam rivera", "--name", "Sam"], "username"],
    [["--username", "sam-rivera", "--name", "Sam"], "username"],
    // A dot only between other characters, so the placeholder address is always valid.
    [["--username", ".sam", "--name", "Sam"], "username"],
    [["--username", "sam.", "--name", "Sam"], "username"],
    [["--username", "sam..rivera", "--name", "Sam"], "username"],
    [["--username", "sam", "--name", "   "], "name"],
    [["--username", "sam", "--name", "x".repeat(101)], "name"],
    [["--name", "Sam"], "username"],
    [["--username", "sam"], "name"],
  ])("exits 1 with invalid_input for %j and creates nothing", async (args, field) => {
    const result = await create([...args, "--json"]);
    expect(result.code).toBe(1);
    expect(result.json.ok).toBe(false);
    expect(result.json.error).toBe("invalid_input");
    expect(typeof result.json.fields[field]).toBe("string");
    expect(await counts(t.db)).toMatchObject({ users: 0, organizations: 0, members: 0, events: 0 });
    expect((await t.db.select().from(installation))[0]!.state).toBe("unclaimed");
  });

  it("exits 1 on an unknown option", async () => {
    const result = await create([...VALID, "--admin", "--json"]);
    expect(result.code).toBe(1);
    expect(result.json).toMatchObject({ ok: false, error: "usage" });
  });

  it("accepts a name of exactly 100 characters", async () => {
    const result = await create(["--username", "sam", "--name", "x".repeat(100), "--json"]);
    expect(result.code).toBe(0);
  });

  it("accepts usernames of 3 and 30 characters", async () => {
    expect((await create(["--username", "sam", "--name", "Sam", "--json"])).code).toBe(0);
    await t.destroy();
    t = await createTestDatabase();
    expect((await create(["--username", "s".repeat(30), "--name", "Sam", "--json"])).code).toBe(0);
  });

  it("stores an email given with --email, in lower case and unverified", async () => {
    const result = await create([...WITH_EMAIL, "--json"]);
    expect(result.code).toBe(0);
    expect(result.json).toMatchObject({ ok: true, username: "sam.rivera", email: "sam@example.com" });
    const [owner] = await t.db.select().from(user);
    expect(owner).toMatchObject({ username: "sam.rivera", email: "sam@example.com", emailVerified: false });

    const human = await create(WITH_EMAIL);
    expect(human.code).toBe(2);
    await t.destroy();
    t = await createTestDatabase();
    const printed = await create(WITH_EMAIL);
    expect(printed.stdout.split("\n")[0]).toBe("Owner created: Sam Rivera (username sam.rivera, email sam@example.com, unverified)");
  });

  it("exits 3 with storage_unavailable when the database is down, and changes nothing", async () => {
    await t.stop();
    const result = await create([...VALID, "--json"]);
    expect(result.code).toBe(3);
    expect(result.json).toEqual({ ok: false, error: "storage_unavailable", message: "The database could not be read." });
    await t.restore();
    expect(await counts(t.db)).toMatchObject({ users: 0, organizations: 0, events: 0 });
    expect((await t.db.select().from(installation))[0]!.state).toBe("unclaimed");
  });

  it("exits 3 when the installation record is missing, rather than treating it as no owner", async () => {
    await t.db.delete(installation);
    const result = await create([...VALID, "--json"]);
    expect(result.code).toBe(3);
    expect(result.json.error).toBe("storage_unavailable");
    expect(await counts(t.db)).toMatchObject({ users: 0, organizations: 0 });
  });

  describe("rerun after an interrupted run", () => {
    const commandAuth = () =>
      createCommandAuth({ config: { publicUrl: PUBLIC_URL, authSecret: TEST_SECRET }, db: t.db }, () => {});

    // What an earlier run with VALID creates in step 2.
    const EARLIER_ACCOUNT = { username: "sam.rivera", email: "sam.rivera@users.invalid", name: "Sam Rivera" };

    async function finishAndCheck(expectIds: { userId: string; workspaceId?: string }) {
      const result = await create([...VALID, "--json"]);
      expect(result.code).toBe(0);
      expect(await counts(t.db)).toMatchObject({ users: 1, organizations: 1, members: 1, actors: 2, events: 1 });
      const [owner] = await t.db.select().from(user);
      expect(owner!.id).toBe(expectIds.userId);
      const [workspace] = await t.db.select().from(organization);
      if (expectIds.workspaceId) expect(workspace!.id).toBe(expectIds.workspaceId);
      const [claim] = await t.db.select().from(installation);
      expect(claim).toMatchObject({ state: "claimed", workspaceId: workspace!.id });
      const [membership] = await t.db.select().from(member);
      expect(membership).toMatchObject({ userId: owner!.id, organizationId: workspace!.id, role: "owner" });
    }

    it("finishes after stopping once the account existed", async () => {
      const auth = commandAuth();
      const { user: created } = await auth.api.signUpEmail({
        body: { ...EARLIER_ACCOUNT, password: "a-random-password-for-the-test" },
      });
      await finishAndCheck({ userId: created.id });
    });

    it("finishes after stopping once the workspace and membership existed", async () => {
      const auth = commandAuth();
      const { user: created } = await auth.api.signUpEmail({
        body: { ...EARLIER_ACCOUNT, password: "a-random-password-for-the-test" },
      });
      const workspace = await auth.api.createOrganization({
        body: { name: "Sam Rivera's space", slug: created.id, userId: created.id },
      });
      await finishAndCheck({ userId: created.id, workspaceId: workspace!.id });
    });

    it("finishes after stopping between the workspace and its membership", async () => {
      const auth = commandAuth();
      const { user: created } = await auth.api.signUpEmail({
        body: { ...EARLIER_ACCOUNT, password: "a-random-password-for-the-test" },
      });
      const [workspace] = await t.db
        .insert(organization)
        .values({ name: "Sam Rivera's space", slug: created.id, createdAt: new Date() })
        .returning();
      await finishAndCheck({ userId: created.id, workspaceId: workspace!.id });
    });

    it("refuses a different username after an earlier run created the account, and names the earlier one", async () => {
      await commandAuth().api.signUpEmail({ body: { ...EARLIER_ACCOUNT, password: "a-random-password-for-the-test" } });
      const result = await create(["--username", "someone", "--name", "Someone", "--json"]);
      expect(result.code).toBe(1);
      expect(result.json).toMatchObject({ ok: false, error: "invalid_input" });
      expect(result.json.fields.username).toContain("sam.rivera");
      expect(await counts(t.db)).toMatchObject({ users: 1, organizations: 0 });
    });

    it("never marks the installation claimed without its workspace", async () => {
      await expect(
        t.db.execute(sql`update installation set state = 'claimed', claimed_at = now() where id = 1`),
      ).rejects.toThrow();
      expect((await t.db.select().from(installation))[0]!.state).toBe("unclaimed");
    });
  });
});

describe("create-owner unexpected failures", () => {
  it("exits 4 with one JSON object when the configuration is invalid", async () => {
    const result = await runCommand("create-owner", [...VALID, "--json"], {
      databaseUrl: t.url,
      env: { BETTER_AUTH_SECRET: "short" },
    });
    expect(result.code).toBe(4);
    expect(result.stdout.trim().split("\n")).toHaveLength(1);
    expect(result.json).toMatchObject({ ok: false, error: "unexpected" });
    expect(result.json.message).toMatch(/BETTER_AUTH_SECRET/);
    expect(await counts(t.db)).toMatchObject({ users: 0, organizations: 0 });
  });

  it("exits 4 on an internal error and never reports success", async () => {
    await t.db.delete(actor).where(eq(actor.kind, "operator"));
    const result = await create([...VALID, "--json"]);
    expect(result.code).toBe(4);
    expect(result.json).toEqual({
      ok: false,
      error: "unexpected",
      message: "Something unexpected went wrong. Nothing was reported as done.",
    });
    expect((await t.db.select().from(installation))[0]!.state).toBe("unclaimed");
  });
});

describe("create-owner run concurrently", () => {
  it("lets one of two runs started together create the owner; the other finds it", async () => {
    // Hold the command's lock so both runs are waiting at once, then let them go.
    const holder = new pg.Client({ connectionString: t.url });
    await holder.connect();
    await holder.query("select pg_advisory_lock(7959002)");
    const runs = Promise.all([
      create(["--username", "alex", "--name", "A", "--json"]),
      create(["--username", "blake", "--name", "B", "--json"]),
    ]);
    try {
      const deadline = Date.now() + 30_000;
      for (;;) {
        const waiting = await t.pool.query(
          `select count(*)::int as n from pg_stat_activity where datname = $1 and wait_event = 'advisory'`,
          [t.name],
        );
        if (waiting.rows[0].n >= 2) break;
        if (Date.now() > deadline) throw new Error("the runs never waited for the lock");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    } finally {
      await holder.query("select pg_advisory_unlock(7959002)");
      await holder.end();
    }
    const [a, b] = await runs;
    expect([a.code, b.code].sort()).toEqual([0, 2]);
    expect([a.json.error, b.json.error].filter(Boolean)).toEqual(["owner_exists"]);
    expect(await counts(t.db)).toMatchObject({ users: 1, organizations: 1, members: 1, events: 1 });
  });

  it("reports owner_exists, not an unexpected error, when the claim is taken while it runs", async () => {
    // Another connection claims the installation and holds the row until create-owner is waiting on it.
    const other = new pg.Client({ connectionString: t.url });
    await other.connect();
    try {
      await other.query("begin");
      const [{ id }] = (
        await other.query(
          `insert into organization (name, slug, created_at) values ('Elsewhere', 'elsewhere', now()) returning id`,
        )
      ).rows;
      await other.query(`update installation set state = 'claimed', workspace_id = $1, claimed_at = now() where id = 1`, [id]);

      const run = createOwner({ config: { publicUrl: PUBLIC_URL, authSecret: TEST_SECRET }, db: t.db }, {
        username: "sam",
        name: "Sam Rivera",
      });
      const deadline = Date.now() + 30_000;
      for (;;) {
        const waiting = await t.pool.query(
          `select count(*)::int as n from pg_stat_activity where datname = $1 and wait_event_type = 'Lock'`,
          [t.name],
        );
        if (waiting.rows[0].n >= 1) break;
        if (Date.now() > deadline) throw new Error("create-owner never waited for the claim");
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await other.query("commit");
      expect(await run).toEqual({ ok: false, error: "owner_exists" });
    } finally {
      await other.end();
    }
    const [claim] = await t.db.select().from(installation);
    expect(claim!.state).toBe("claimed");
    expect(await t.db.select().from(event)).toEqual([]);
  });
});
