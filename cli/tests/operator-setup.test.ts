import { mkdtemp, readFile, rm, stat, writeFile, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupWorkspace } from "../src/commands/setup.ts";
import { prepareInstallation } from "../src/commands/init.ts";
import { createOwner, startInstallation } from "../src/commands/start.ts";
import { showOwner } from "../src/server.ts";
import { Ui } from "../src/ui.ts";

vi.mock("../src/commands/init.ts", () => ({ prepareInstallation: vi.fn() }));
vi.mock("../src/commands/start.ts", () => ({ createOwner: vi.fn(), startInstallation: vi.fn() }));
vi.mock("../src/server.ts", () => ({ showOwner: vi.fn() }));

const ui = new Ui({ json:true, verbose:false, yes:false });
const url = "http://space.localhost/reset-password#token=synthetic-handoff";
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ys-setup-test-"));
  vi.clearAllMocks();
  vi.spyOn(ui,"result").mockImplementation(() => {});
  vi.mocked(prepareInstallation).mockImplementation(async (_ui,folder) => {
    await mkdir(join(folder,"modes"));
    await Promise.all(Object.entries({
      "compose.yaml":"name: your-space\n", "stack.yaml":"services: {}\n", ".env":"", "env.example":"", "modes/mode.yaml":"services: {}\n",
    }).map(([name,text])=>writeFile(join(folder,name),text)));
    return { folder, version:"test", setup:{kind:"this-machine"}, env:[] };
  });
  vi.mocked(startInstallation).mockResolvedValue({
    folder:dir, running:true, version:"test", setup:{kind:"this-machine",address:"http://space.localhost"}, services:[], owner:null,
    apps:[], engine:null, forward:null, certificate:null,
  });
  vi.mocked(showOwner).mockResolvedValue(null);
  vi.mocked(createOwner).mockResolvedValue({ url, expiresAt:"2099-01-01" });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir,{recursive:true,force:true});
});

describe("operator setup", () => {
  it("resumes a partial install, persists the handoff privately and prints only its path", async () => {
    await writeFile(join(dir,"env.example"),"");
    await setupWorkspace(ui,dir,{});
    const handoff = join(dir,".your-space-owner-link");
    expect((await stat(handoff)).mode & 0o777).toBe(0o600);
    expect((await readFile(handoff,"utf8")).trim()).toBe(url);
    expect(ui.result).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(vi.mocked(ui.result).mock.calls)).not.toContain("#token=");
    expect(createOwner).toHaveBeenCalledWith(ui,expect.anything(),{ownerName:"Owner",ownerUsername:"owner",open:false});
    const before = await stat(handoff);
    vi.mocked(showOwner).mockResolvedValue({name:"Owner",username:"owner"});
    await setupWorkspace(ui,dir,{ownerName:"Different"});
    expect((await stat(handoff)).ino).toBe(before.ino);
    expect(prepareInstallation).toHaveBeenCalledTimes(1);
    expect(createOwner).toHaveBeenCalledTimes(1);
  });

  it("keeps different contents intact and refuses symlinks during a partial retry", async () => {
    await writeFile(join(dir,"stack.yaml"),"different");
    await expect(setupWorkspace(ui,dir,{})).rejects.toMatchObject({code:"folder_not_empty"});
    expect(await readFile(join(dir,"stack.yaml"),"utf8")).toBe("different");
    expect(startInstallation).not.toHaveBeenCalled();
    await rm(join(dir,"stack.yaml"));
    await symlink(join(dir,"env.example"),join(dir,"stack.yaml"));
    await expect(setupWorkspace(ui,dir,{})).rejects.toMatchObject({code:"folder_not_empty"});
    expect(startInstallation).not.toHaveBeenCalled();
  });

  it("reuses completed install files after a failed startup", async () => {
    vi.mocked(startInstallation).mockRejectedValueOnce(new Error("engine interrupted"));
    await expect(setupWorkspace(ui,dir,{})).rejects.toThrow("engine interrupted");
    expect(createOwner).not.toHaveBeenCalled();
    await setupWorkspace(ui,dir,{ownerName:"Example",ownerUsername:"example"});
    expect(prepareInstallation).toHaveBeenCalledTimes(1);
    expect(createOwner).toHaveBeenCalledWith(ui,expect.anything(),{ownerName:"Example",ownerUsername:"example",open:false});
  });

  it("keeps malformed server output private", async () => {
    vi.mocked(createOwner).mockResolvedValue({url:"https://unrelated.example/reset-password#token=synthetic-handoff",expiresAt:""});
    await expect(setupWorkspace(ui,dir,{})).rejects.toMatchObject({code:"storage_unavailable",detail:undefined});
    expect(ui.result).not.toHaveBeenCalled();
    expect(await stat(join(dir,".your-space-owner-link")).catch(()=>null)).toBe(null);
  });
});
