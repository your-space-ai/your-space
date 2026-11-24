// An app's Compose file that names other Compose files is refused before Compose sees it
// (compose-file.ts): Compose reads an `include`, its `env_file` and an `extends` file while it reads
// the app's file, even as written, in every form Compose takes them in.
import { describe, expect, it } from "vitest";
import { otherComposeFiles } from "../src/apps/compose-file.ts";
import { refreshRuntimeInterface, RuntimeError, socketRuntime, type AppSpec } from "../src/apps/runtime-client.ts";

const ONE_FILE = `x-base: &base
  image: traefik/whoami:latest
services:
  base:
    <<: *base
  web:
    extends: base
    env_file: .env
`;

describe("otherComposeFiles", () => {
  it("passes a file that names no other Compose file, anchors and same-file extends included", () => {
    expect(otherComposeFiles(ONE_FILE)).toBeNull();
    expect(otherComposeFiles("services:\n  web:\n    image: nginx\n    extends: { service: base }\n  base:\n    image: nginx\n")).toBeNull();
  });

  it.each([
    ["include", "include:\n  - path: child.yaml\n    env_file: /dev/zero\nservices:\n  web:\n    image: nginx\n"],
    ["include, short form", "include: [/etc/compose.yaml]\nservices:\n  web:\n    image: nginx\n"],
    ["include behind a merge key", "x-a: &a\n  include: [/etc/compose.yaml]\n<<: *a\nservices:\n  web:\n    image: nginx\n"],
    ["include in a later document", "services:\n  web:\n    image: nginx\n---\ninclude: [/etc/compose.yaml]\n"],
    ["include with an escaped key", '"incl\\x75de": [/etc/compose.yaml]\nservices:\n  web:\n    image: nginx\n'],
    ["include in flow style", "{include: [/etc/compose.yaml], services: {web: {image: nginx}}}\n"],
    ["include as a complex key", "? include\n: [/etc/compose.yaml]\nservices:\n  web:\n    image: nginx\n"],
    ["include with a Compose tag", "include: !override [/etc/compose.yaml]\nservices:\n  web:\n    image: nginx\n"],
  ])("refuses %s", (_, text) => {
    expect(otherComposeFiles(text)).toMatch(/^The file names other Compose files, which Compose would read from the machine: the files it includes\./);
  });

  it("refuses a service that extends one in another file, directly or behind a merge key", () => {
    expect(otherComposeFiles("services:\n  web:\n    image: nginx\n    extends: { file: /etc/base.yaml, service: x }\n")).toContain("/etc/base.yaml, which service web extends");
    expect(otherComposeFiles("x-b: &b\n  extends: { file: ../base.yaml, service: x }\nservices:\n  api:\n    <<: *b\n    image: nginx\n")).toContain(
      "../base.yaml, which service api extends",
    );
  });

  it("refuses a file it can't read as YAML, so nothing unchecked reaches Compose", () => {
    expect(otherComposeFiles("services:\n  web: [\n")).toBe("The file isn't a Compose file Your Space can read: it isn't valid YAML.");
    const bomb = ["a: &a [x, x, x, x, x, x, x, x, x, x]", ..."bcdefghij".split("").map((k, i) => `${k}: &${k} [${Array(10).fill(`*${"abcdefghij"[i]}`).join(", ")}]`)].join("\n");
    expect(otherComposeFiles(bomb)).toBe("The file isn't a Compose file Your Space can read: it isn't valid YAML.");
  });
});

describe("the runtime client", () => {
  const spec: AppSpec = { project: "ys-notes", app: "notes", compose: "include: [/etc/compose.yaml]\nservices:\n  web:\n    image: nginx\n", env: {} };
  // No runtime manager listens here: a file that names another is refused before anything is sent.
  const runtime = socketRuntime("/nonexistent/ys-runtime.sock");

  it.each([
    ["check", () => runtime.check(spec)],
    ["apply", () => runtime.apply(spec, () => {})],
    ["an interface refresh", () => refreshRuntimeInterface(spec)],
  ])("refuses it for %s without sending it", async (_, send) => {
    const refused = await send().catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(RuntimeError);
    expect(refused).toMatchObject({ status: 400, code: "refused" });
  });

  it("sends a file that names no other", async () => {
    const sent = await runtime.check({ ...spec, compose: ONE_FILE }).catch((error: unknown) => error);
    expect(sent).toMatchObject({ code: "runtime_unavailable" });
  });
});
