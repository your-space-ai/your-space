import { expect, it, vi } from "vitest";
import { check, validateSpec } from "../src/apps.ts";
import { docker, engineInfo, inspectImage } from "../src/engine.ts";
import { EGRESS_IMAGE } from "../src/adapter.ts";

vi.mock("../src/engine.ts", async (load) => ({
  ...(await load<typeof import("../src/engine.ts")>()),
  docker: vi.fn(),
  engineInfo: vi.fn(),
  inspectImage: vi.fn(),
}));

it("checks a replacement image by exact registry digest on this engine and preserves existing pins", async () => {
  const pin = "sha256:" + "c".repeat(64);
  const egress = "sha256:" + "e".repeat(64);
  const resolved = { services: { web: { image: "example/app:stable@" + pin } } };
  const spec = validateSpec({
    project: "ys-demo",
    app: "demo",
    compose: JSON.stringify(resolved),
    pins: { "example/app:stable": pin, [EGRESS_IMAGE + ":latest"]: egress },
    verifyPins: ["example/app:stable"],
  });
  vi.mocked(docker).mockImplementation(async (args) => ({
    code: 0,
    stdout: args.includes("--variables") ? "{}" : JSON.stringify(resolved),
    stderr: "",
  }));
  vi.mocked(engineInfo).mockResolvedValue({ reachable: true, arch: "arm64", connection: "fixture" });
  vi.mocked(inspectImage).mockResolvedValue({
    ref: "example/app@" + pin,
    digest: pin,
    runsHere: true,
    platforms: ["linux/arm64"],
  });
  const answer = await check(spec);
  expect(answer.ok).toBe(true);
  expect(inspectImage).toHaveBeenCalledExactlyOnceWith("example/app@" + pin, "arm64");
  expect(answer.images).toEqual(
    expect.arrayContaining([expect.objectContaining({ ref: "example/app:stable", digest: pin })]),
  );
  vi.mocked(inspectImage).mockResolvedValue({ ref: "unused", digest: egress, runsHere: true, platforms: [] });
  expect((await check(spec)).ok).toBe(false);
  vi.mocked(inspectImage).mockResolvedValue({
    ref: "unused",
    digest: pin,
    runsHere: false,
    platforms: ["linux/amd64"],
  });
  expect((await check(spec)).ok).toBe(false);
});
