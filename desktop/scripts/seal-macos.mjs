// Packages and checks the exact Darwin Electron bundle before signing. Call
// "verify" on a release archive after extracting it, using the pinned build tools.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createPackage, extractFile, getRawHeader } from "@electron/asar";
import { flipFuses, FuseState, FuseV1Options, FuseVersion, getCurrentFuseWire } from "@electron/fuses";

const [mode, bundle] = process.argv.slice(2);
assert.ok(["seal","verify"].includes(mode) && bundle, "Usage: seal-macos.mjs seal|verify APP");
const resources = join(bundle,"Contents","Resources");
const loose = join(resources,"app");
const archive = join(resources,"app.asar");
const plist = join(bundle,"Contents","Info.plist");
const hash = content => createHash("sha256").update(content).digest("hex");
const settings = {
  [FuseV1Options.RunAsNode]:false,
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable]:false,
  [FuseV1Options.EnableNodeCliInspectArguments]:false,
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]:true,
  [FuseV1Options.OnlyLoadAppFromAsar]:true,
};

if (mode === "seal") {
  await createPackage(loose,archive);
  const integrity = {"Resources/app.asar":{algorithm:"SHA256",hash:hash(getRawHeader(archive).headerString)}};
  execFileSync("/usr/bin/plutil",["-replace","ElectronAsarIntegrity","-json",JSON.stringify(integrity),plist]);
  await flipFuses(bundle,{version:FuseVersion.V1,...settings});
  rmSync(loose,{recursive:true});
}
assert.ok(!existsSync(loose) && !existsSync(archive+".unpacked"), "The launcher must be entirely in app.asar");
const wire = await getCurrentFuseWire(bundle);
assert.equal(wire.version,FuseVersion.V1);
for (const [key, enabled] of Object.entries(settings)) {
  assert.equal(wire[key],enabled ? FuseState.ENABLE : FuseState.DISABLE, "Unexpected " + FuseV1Options[key] + " fuse");
}
const {header,headerString} = getRawHeader(archive);
const integrity = JSON.parse(execFileSync("/usr/bin/plutil",["-extract","ElectronAsarIntegrity","json","-o","-",plist]));
assert.deepEqual(integrity,{"Resources/app.asar":{algorithm:"SHA256",hash:hash(headerString)}},"ASAR header integrity mismatch");

function verifyFiles(files, parent = "") {
  for (const [name,entry] of Object.entries(files)) {
    const path = parent ? parent + "/" + name : name;
    if (entry.files) { verifyFiles(entry.files,path); continue; }
    assert.ok(!entry.link && !entry.unpacked && entry.integrity?.algorithm === "SHA256", "Unsealed ASAR entry");
    assert.equal(hash(extractFile(archive,path)),entry.integrity.hash,"ASAR file integrity mismatch");
  }
}
verifyFiles(header.files);
console.log("Verified five Electron fuses, ASAR header and all launcher files.");
