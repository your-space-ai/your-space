import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { newApp, packApp } from "../src/commands/scaffold.ts";
import { Ui } from "../src/ui.ts";

let temp: string, folder: string;
const ui = new Ui({ json: true, yes: false, verbose: false });
beforeEach(async () => {
  temp = await mkdtemp(join(tmpdir(), "ys-starter-"));
  folder = join(temp, "morning-board");
  vi.spyOn(ui, "result").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(temp, { recursive: true, force: true });
});

it("creates a portable kit and packs the author's edited page into its service", async () => {
  await newApp(ui, folder);
  const kit = await readFile(join(folder, "kit.yaml"), "utf8");
  expect(kit).toContain("name: morning-board");
  expect(await readFile(join(folder, "index.html"), "utf8")).toContain("your-space:home:ready");
  await writeFile(join(folder, "index.html"), "<h1>My day</h1>");
  await packApp(ui, folder);
  const output = await readFile(join(folder, "compose.yaml"), "utf8");
  const service = JSON.parse(output.slice(output.indexOf("\n") + 1)).services.web;
  expect(Buffer.from(service.environment.PAGE_BASE64, "base64").toString()).toBe("<h1>My day</h1>");
  expect(service.read_only).toBe(true);
  await expect(newApp(ui, folder)).rejects.toMatchObject({ code: "folder_not_empty" });
});
it("preserves hand-written compose and refuses symlinks to other files", async () => {
  await newApp(ui, folder);
  await writeFile(join(folder, "compose.yaml"), "services: {}");
  await expect(packApp(ui, folder)).rejects.toMatchObject({ code: "invalid_input" });
  expect(await readFile(join(folder, "compose.yaml"), "utf8")).toBe("services: {}");
  await rm(join(folder, "compose.yaml"));
  await rm(join(folder, "index.html"));
  await symlink(join(folder, "kit.yaml"), join(folder, "index.html"));
  await expect(packApp(ui, folder)).rejects.toMatchObject({ code: "invalid_input" });
});
