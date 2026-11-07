// T023: the create-owner command (User Story 1; contracts/operator-commands.md).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { createCommandAuth } from "../src/auth.ts";
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
const VALID = ["--email", "Sam@Example.COM", "--name", "Sam Rivera"];

describe("create-owner", () => {
  it("creates exactly one account, workspace, owner membership, actor, event, and claim", async () => {
    const before = Date.now();
    const result = await create([...VALID, "--json"]);
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);

    // --json output matches the contract exactly.
    expect(Object.keys(result.json).sort()).toEqual(["email", "expiresAt", "ok", "token", "url"]);
    expect(result.json.ok).toBe(true);
    expect(result.json.email).toBe("sam@example.com");
    expect(result.json.token).toMatch(/^[A-Za-z0-9]{24}$/);
    expect(result.json.url).toBe(`${PUBLIC_URL}/reset-password#token=${result.json.token}`);
    expect(result.json.expiresAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
    const expires = Date.parse(result.json.expiresAt);
    expect(expires).toBeGreaterThanOrEqual(before + 29 * 60_000);
    expect(expires).toBeLessThanOrEqual(Date.now() + 30 * 60_000);

    expect(await counts(t.db)).toMatchObject({ users: 1, organizations: 1, members: 1, sessions: 0, actors: 2, events: 1 });

    const [owner] = await t.db.select().from(user);
    expect(owner).toMatchObject({ name: "Sam Rivera", email: "sam@example.com", emailVerified: false });

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
    expect(tokens[0]!.identifier).toBe(`reset-password:${result.json.token}`);
  });

  it("prints the human-readable output by default", async () => {
    const result = await create(VALID);
    expect(result.code).toBe(0);
    const lines = result.stdout.trim().split("\n");
    expect(lines[0]).toBe("Owner created: Sam Rivera <sam@example.com>");
    expect(lines[1]).toMatch(/^Set your password here \(expires \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ, works once\):$/);
    expect(lines[2]).toMatch(new RegExp(`^${PUBLIC_URL}/reset-password#token=[A-Za-z0-9]{24}$`));
    expect(lines[3]).toBe("If it expires, run: docker compose exec server reset-link");
  });

  it("exits 2 with owner_exists when run again, and changes nothing", async () => {
    expect((await create([...VALID, "--json"])).code).toBe(0);
    const before = await counts(t.db);

    for (const args of [VALID, ["--email", "other@example.com", "--name", "Someone Else"]]) {
      const again = await create([...args, "--json"]);
      expect(again.code).toBe(2);
      expect(again.json).toEqual({ ok: false, error: "owner_exists", message: "This installation already has an owner." });
    }
    const human = await create(VALID);
    expect(human.code).toBe(2);
    expect(human.stdout).toBe("");
    expect(human.stderr).toContain("already has an owner");

    expect(await counts(t.db)).toEqual(before);
    expect(await t.db.select({ email: user.email }).from(user)).toEqual([{ email: "sam@example.com" }]);
  });

  it.each([
    [["--email", "not-an-email", "--name", "Sam"], "email"],
    [["--email", `${"a".repeat(250)}@x.co`, "--name", "Sam"], "email"],
    [["--email", "sam@example.com", "--name", "   "], "name"],
    [["--email", "sam@example.com", "--name", "x".repeat(101)], "name"],
    [["--name", "Sam"], "email"],
    [["--email", "sam@example.com"], "name"],
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
    const result = await create(["--email", "sam@example.com", "--name", "x".repeat(100), "--json"]);
    expect(result.code).toBe(0);
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
        body: { email: "sam@example.com", name: "Sam Rivera", password: "a-random-password-for-the-test" },
      });
      await finishAndCheck({ userId: created.id });
    });

    it("finishes after stopping once the workspace and membership existed", async () => {
      const auth = commandAuth();
      const { user: created } = await auth.api.signUpEmail({
        body: { email: "sam@example.com", name: "Sam Rivera", password: "a-random-password-for-the-test" },
      });
      const workspace = await auth.api.createOrganization({
        body: { name: "Sam Rivera's space", slug: created.id, userId: created.id },
      });
      await finishAndCheck({ userId: created.id, workspaceId: workspace!.id });
    });

    it("finishes after stopping between the workspace and its membership", async () => {
      const auth = commandAuth();
      const { user: created } = await auth.api.signUpEmail({
        body: { email: "sam@example.com", name: "Sam Rivera", password: "a-random-password-for-the-test" },
      });
      const [workspace] = await t.db
        .insert(organization)
        .values({ name: "Sam Rivera's space", slug: created.id, createdAt: new Date() })
        .returning();
      await finishAndCheck({ userId: created.id, workspaceId: workspace!.id });
    });

    it("never marks the installation claimed without its workspace", async () => {
      await expect(
        t.db.execute(sql`update installation set state = 'claimed', claimed_at = now() where id = 1`),
      ).rejects.toThrow();
      expect((await t.db.select().from(installation))[0]!.state).toBe("unclaimed");
    });
  });
});
