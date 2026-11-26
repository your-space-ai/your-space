// desktop/scripts/notarize-macos.sh, which only the signing jobs run, on a Mac with Apple's tools, the
// Developer ID identity and the notary key. Nothing runs it before the first release draft or Mac
// canary, so these run it as it is, copied beside stand-ins for its helper scripts, with stand-ins for
// Apple's tools first on PATH. Each stand-in records its call and acts on scratch files: an image is a
// tar of the app, a ZIP lists the app's files, and stapling leaves a ticket file. The checks cover
// both forms, a release's (a DMG and an update ZIP) and the Mac canary's (--update-only, the update
// ZIPs alone), in the order the calls are made and the files they write.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../scripts/notarize-macos.sh", import.meta.url));
const version = "0.1.0-alpha.2.canary.20261201.60";
const developerId = "anchor apple generic and certificate leaf[field.1.2.840.113635.100.6.1.13] exists";
const cpus = { arm64: "arm64", x64: "x86_64" };

// The stand-ins, each a bash script. Those that act log "NAME ARGS" to $FAKE_MAC/log; lipo, plutil,
// shasum and uname only read, so they don't.
const log = 'echo "$(basename "$0") $*" >> "$FAKE_MAC/log"';
const tools = {
  hdiutil: `${log}
case $1 in
  attach)
    shift
    while (($# > 1)); do if [[ $1 == -mountpoint ]]; then mount=$2; shift; fi; shift; done
    mkdir -p "$mount" && tar -xf "$1" -C "$mount" && ln -s /Applications "$mount/Applications" ;;
  detach) rm -rf "$2" ;;
  *) exit 2 ;;
esac`,
  ditto: `${log}
src=\${@: -2:1}
dst=\${@: -1}
if [[ $1 == -c ]]; then
  (cd "$(dirname "$src")" && find "$(basename "$src")" -type f | LC_ALL=C sort | while IFS= read -r file; do echo "$file: $(cat "$file")"; done) > "$dst"
else
  cp -R "$src" "$dst"
fi`,
  lipo: '[[ $1 == -archs ]] && cat "$2"',
  plutil: `[[ $# == 6 && $1 == -extract && $3 == raw && $4 == -o && $5 == - ]] || exit 2
exec node -e 'const value = JSON.parse(require("node:fs").readFileSync(process.argv[2], "utf8"))[process.argv[1]]; if (typeof value !== "string") process.exit(1); console.log(value);' "$2" "$6"`,
  shasum: `[[ $1 == -a && $2 == 256 ]] || exit 2
shift 2
exec node -e '
  const { createHash } = require("node:crypto");
  const { readFileSync } = require("node:fs");
  const files = process.argv.slice(1);
  const hash = data => createHash("sha256").update(data).digest("hex");
  if (files.length) for (const file of files) console.log(\`\${hash(readFileSync(file))}  \${file}\`);
  else console.log(\`\${hash(readFileSync(0))}  -\`);' "$@"`,
  uname: '[[ $* == -m ]] && echo "$FAKE_MACHINE"',
  codesign: log,
  spctl: log,
  xcrun: `${log}
case "$1 $2" in
  "notarytool submit")
    n=$(($(cat "$FAKE_MAC/submitted" 2> /dev/null || echo 0) + 1))
    echo "$n" > "$FAKE_MAC/submitted"
    status=Accepted
    if [[ " $FAKE_INVALID " == *" $n "* ]]; then status=Invalid; fi
    echo "submission-$n $status" >> "$FAKE_MAC/statuses"
    if [[ " $* " == *" --wait "* ]]; then
      echo "{\\"id\\":\\"submission-$n\\",\\"status\\":\\"$status\\",\\"message\\":\\"Processing complete\\"}"
    else
      echo "{\\"id\\":\\"submission-$n\\",\\"message\\":\\"Successfully uploaded file\\",\\"path\\":\\"$3\\"}"
    fi ;;
  "notarytool wait")
    status=$(awk -v id="$3" '$1 == id { print $2 }' "$FAKE_MAC/statuses")
    echo "{\\"id\\":\\"$3\\",\\"status\\":\\"$status\\",\\"message\\":\\"Processing complete\\"}" ;;
  # An app's ticket is a file inside it, so it travels in its ZIP and its image; a DMG's is beside it.
  "stapler staple") if [[ -d $3 ]]; then echo stapled > "$3/Contents/ticket"; else echo stapled > "$3.ticket"; fi ;;
  "stapler validate") [[ -f $3/Contents/ticket || -f $3.ticket ]] ;;
  *) exit 2 ;;
esac`,
};
// The helper scripts notarize-macos.sh runs from its own folder.
const helpers = {
  "sign-bundle.sh": `${log}
echo "$2" > "$1/Contents/signature"`,
  "cli-version.sh": `${log}
plutil -extract CFBundleShortVersionString raw -o - "$1/Contents/Info.plist"`,
  "create-dmg.sh": `${log}
tar -cf "$2" -C "$(dirname "$1")" "$(basename "$1")"`,
};

/** A scratch Mac: the script beside its helpers, the tools, and candidate images of the given builds. */
function mac(t) {
  const dir = mkdtempSync(join(tmpdir(), "ys-notarize-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const folder of ["bin", "tools", "in", "out", "tmp", "app"]) mkdirSync(join(dir, folder));
  const write = (path, text) => {
    writeFileSync(path, `#!/bin/bash\nset -euo pipefail\n${text}\n`);
    chmodSync(path, 0o755);
  };
  for (const [name, text] of Object.entries(tools)) write(join(dir, "tools", name), text);
  for (const [name, text] of Object.entries(helpers)) write(join(dir, "bin", name), text);
  copyFileSync(script, join(dir, "bin/notarize-macos.sh"));
  chmodSync(join(dir, "bin/notarize-macos.sh"), 0o755);
  writeFileSync(join(dir, "key.p8"), "not a key");

  /** A candidate image of an app for arch at build, as Build macOS app names it, unless named otherwise. */
  const candidate = (arch, build = version, name = `your-space-macos-${arch}-${build}-candidate.dmg`) => {
    const app = join(dir, "app", `${arch}-${build}`, "Your Space.app");
    mkdirSync(join(app, "Contents/MacOS"), { recursive: true });
    mkdirSync(join(app, "Contents/Resources/bin"), { recursive: true });
    writeFileSync(join(app, "Contents/MacOS/Your Space"), cpus[arch]);
    writeFileSync(join(app, "Contents/Resources/bin/your-space"), cpus[arch]);
    writeFileSync(join(app, "Contents/Resources/app.asar"), `the ${arch} launcher of ${build}`);
    writeFileSync(join(app, "Contents/Info.plist"), JSON.stringify({ CFBundleShortVersionString: build }));
    const result = spawnSync("tar", ["-cf", join(dir, "in", name), "-C", join(app, ".."), "Your Space.app"]);
    assert.equal(result.status, 0, String(result.stderr));
    return join(dir, "in", name);
  };

  /** Runs the script with args on a Mac of the given processor, with what it logged and wrote. */
  const run = (args, { machine = "arm64", invalid = "" } = {}) => {
    rmSync(join(dir, "log"), { force: true });
    const env = {
      ...process.env, PATH: `${join(dir, "tools")}:${process.env.PATH}`, TMPDIR: join(dir, "tmp"), FAKE_MAC: dir,
      FAKE_MACHINE: machine, FAKE_INVALID: invalid, MACOS_SIGN_IDENTITY: "IDENTITY",
      APPLE_API_KEY_PATH: join(dir, "key.p8"), APPLE_API_KEY_ID: "KEY-ID", APPLE_API_ISSUER: "ISSUER",
    };
    const result = spawnSync(join(dir, "bin/notarize-macos.sh"), args, { encoding: "utf8", env });
    const logged = existsSync(join(dir, "log")) ? readFileSync(join(dir, "log"), "utf8").trim().split("\n") : [];
    const work = join(dir, "tmp");
    const calls = logged.map(line =>
      line.replace(new RegExp(`${work.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}/tmp\\.\\w+`, "g"), "WORK").replaceAll(join(dir, "in"), "IN").replaceAll(join(dir, "key.p8"), "KEY").replaceAll(developerId, "DEVELOPER-ID"));
    const written = readdirSync(join(dir, "out")).sort();
    return { ...result, calls, written, out: name => readFileSync(join(dir, "out", name), "utf8") };
  };
  return { candidate, run, out: join(dir, "out"), dir };
}

const submit = file => `xcrun notarytool submit ${file} --key KEY --key-id KEY-ID --issuer ISSUER`;
const zipApp = (app, zip) => `ditto -c -k --norsrc --noextattr --noacl --noqtn --keepParent ${app} ${zip}`;
/** The calls that copy a candidate's app to app, check it, sign it and zip it for Apple, on a Mac that runs its CLI or not. */
const signApp = (image, app, zip, runsCli) => [
  `hdiutil attach -readonly -nobrowse -noautoopen -mountpoint WORK/mount ${image}`,
  `ditto --rsrc --extattr --noqtn WORK/mount/Your Space.app ${app}`,
  "hdiutil detach WORK/mount -quiet",
  `codesign --verify --deep --strict ${app}`,
  `sign-bundle.sh ${app} IDENTITY`,
  `codesign --verify --deep --strict -R=DEVELOPER-ID ${app}`,
  ...(runsCli ? [`cli-version.sh ${app}`] : []),
  zipApp(app, zip),
];
/** Each line of an update ZIP as the ditto stand-in writes it: the signed, stapled app of arch. */
const updateZip = arch => [
  `Your Space.app/Contents/Info.plist: ${JSON.stringify({ CFBundleShortVersionString: version })}`,
  `Your Space.app/Contents/MacOS/Your Space: ${cpus[arch]}`,
  `Your Space.app/Contents/Resources/app.asar: the ${arch} launcher of ${version}`,
  `Your Space.app/Contents/Resources/bin/your-space: ${cpus[arch]}`,
  "Your Space.app/Contents/signature: IDENTITY",
  "Your Space.app/Contents/ticket: stapled",
].join("\n");
const sha256Line = (data, name) => `${createHash("sha256").update(data).digest("hex")}  ${name}\n`;

test("a release's candidate becomes its notarized DMG and the update ZIP of the same stapled app", t => {
  for (const [arch, machine] of [["arm64", "arm64"], ["x64", "arm64"], ["x64", "x86_64"]]) {
    const m = mac(t);
    const candidate = m.candidate(arch);
    const { status, stderr, calls, written, out } = m.run([candidate, m.out], { machine });
    assert.equal(status, 0, stderr);
    const dmg = `your-space-macos-${arch}-${version}.dmg`;
    const zip = `your-space-macos-${arch}-${version}.zip`;
    const app = "WORK/Your Space.app";
    assert.deepEqual(calls, [
      ...signApp(`IN/${candidate.split("/").pop()}`, app, "WORK/submit.zip", cpus[arch] === machine),
      `${submit("submit.zip")} --wait --output-format json`,
      `xcrun stapler staple ${app}`,
      `xcrun stapler validate ${app}`,
      zipApp(app, zip),
      `create-dmg.sh ${app} WORK/${dmg}`,
      `codesign --sign IDENTITY --timestamp --identifier ai.your-space.desktop.dmg ${dmg}`,
      `${submit(dmg)} --wait --output-format json`,
      `xcrun stapler staple ${dmg}`,
      `xcrun stapler validate ${dmg}`,
      `codesign --verify --strict -R=DEVELOPER-ID ${dmg}`,
      `spctl --assess --type open --context context:primary-signature ${dmg}`,
      // The app as the DMG delivers it.
      `hdiutil attach -readonly -nobrowse -noautoopen -mountpoint WORK/mount WORK/${dmg}`,
      "xcrun stapler validate WORK/mount/Your Space.app",
      "codesign --verify --deep --strict -R=DEVELOPER-ID WORK/mount/Your Space.app",
      "spctl --assess --type execute WORK/mount/Your Space.app",
      "hdiutil detach WORK/mount -quiet",
    ], `${arch} on ${machine}`);
    assert.deepEqual(written, [dmg, `${dmg}.sha256`, zip, `${zip}.sha256`]);
    assert.equal(out(zip), `${updateZip(arch)}\n`);
    assert.equal(out(`${zip}.sha256`), sha256Line(out(zip), zip));
    assert.equal(out(`${dmg}.sha256`), sha256Line(readFileSync(join(m.out, dmg)), dmg));
  }
});

test("--update-only signs and submits every app before it waits for any, and writes only their update ZIPs", t => {
  for (const machine of ["arm64", "x86_64"]) {
    const m = mac(t);
    const candidates = ["arm64", "x64"].map(arch => m.candidate(arch));
    const { status, stderr, calls, written, out } = m.run(["--update-only", ...candidates, m.out], { machine });
    assert.equal(status, 0, stderr);
    const app = arch => `WORK/${arch}/Your Space.app`;
    const zip = arch => `your-space-macos-${arch}-${version}.zip`;
    assert.deepEqual(calls, [
      ...["arm64", "x64"].flatMap((arch, i) => [
        ...signApp(`IN/${candidates[i].split("/").pop()}`, app(arch), `WORK/${arch}/submit.zip`, cpus[arch] === machine),
        `${submit(`WORK/${arch}/submit.zip`)} --output-format json`,
      ]),
      ...["arm64", "x64"].flatMap((arch, i) => [
        `xcrun notarytool wait submission-${i + 1} --key KEY --key-id KEY-ID --issuer ISSUER --output-format json`,
        `xcrun stapler staple ${app(arch)}`,
        `xcrun stapler validate ${app(arch)}`,
        `codesign --verify --deep --strict -R=DEVELOPER-ID ${app(arch)}`,
        `spctl --assess --type execute ${app(arch)}`,
        zipApp(app(arch), `WORK/${arch}/${zip(arch)}`),
      ]),
    ], machine);
    assert.deepEqual(written, [zip("arm64"), `${zip("arm64")}.sha256`, zip("x64"), `${zip("x64")}.sha256`]);
    for (const arch of ["arm64", "x64"]) {
      assert.equal(out(zip(arch)), `${updateZip(arch)}\n`, arch);
      assert.equal(out(`${zip(arch)}.sha256`), sha256Line(out(zip(arch)), zip(arch)), arch);
    }
  }
});

test("a submission Apple doesn't accept stops it before anything is stapled or written", t => {
  const m = mac(t);
  const candidates = ["arm64", "x64"].map(arch => m.candidate(arch));
  const canary = m.run(["--update-only", ...candidates, m.out], { invalid: "1" });
  assert.notEqual(canary.status, 0);
  assert.match(canary.stderr, /Apple did not accept the arm64 submission submission-1\./);
  assert.equal(canary.calls.filter(call => call.startsWith("xcrun notarytool submit")).length, 2, "both were submitted");
  assert.deepEqual(canary.calls.filter(call => /notarytool wait|stapler/.test(call)), ["xcrun notarytool wait submission-1 --key KEY --key-id KEY-ID --issuer ISSUER --output-format json"]);
  assert.deepEqual(canary.written, []);

  for (const invalid of ["1", "2"]) {
    const other = mac(t);
    const release = other.run([other.candidate("arm64"), other.out], { invalid });
    assert.notEqual(release.status, 0, invalid);
    assert.match(release.stderr, /Apple did not accept the submission\./);
    assert.equal(release.calls.at(-1).startsWith("xcrun notarytool submit"), true, invalid);
    assert.deepEqual(release.written, [], invalid);
  }
});

test("candidates that aren't one for each architecture, of one version, are refused before anything is signed", t => {
  const m = mac(t);
  const arm64 = m.candidate("arm64");
  for (const args of [
    ["--update-only", arm64, arm64, m.out],
    ["--update-only", arm64, m.candidate("x64", "0.1.0-alpha.2.canary.20261202.61"), m.out],
    ["--update-only", arm64, m.candidate("x64", version, "your-space-macos-x64.dmg"), m.out],
    ["--update-only", m.out],
    // A release signs one candidate at a time.
    [arm64, m.candidate("x64"), m.out],
  ]) {
    const { status, calls, written } = m.run(args);
    assert.equal(status, 2, args.join(" "));
    assert.deepEqual(calls, [], args.join(" "));
    assert.deepEqual(written, []);
  }
});
