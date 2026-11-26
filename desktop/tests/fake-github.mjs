// A stand-in for GitHub's releases, for the tests of deploy/alpha-feed.sh. The tests put a `gh`, a
// `curl` and a `sleep` first on PATH that each run this file with their own name, so the script runs
// unchanged and never reaches GitHub. It keeps the releases in $FAKE_GITHUB/state.json, each file's
// contents in $FAKE_GITHUB/assets/, and every call in state.calls. It answers only the calls the
// script makes, as GitHub and gh 2 do, and fails loudly on any other, so a change to the script that
// these tests don't cover shows up here.
//
// state.fail holds failures to inject, each { call, status, times, apply }: the first `times` calls
// whose description starts with `call` fail with that HTTP status, after making their change anyway
// when `apply` is set, as a call GitHub answers with an error can still have made its release.
// state.served lists answers for the feed's fixed address, one per read, before the releases count.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const dir = process.env.FAKE_GITHUB;
const statePath = join(dir, "state.json");
const state = JSON.parse(readFileSync(statePath, "utf8"));
const save = () => writeFileSync(statePath, JSON.stringify(state, null, 2));
const [tool, ...args] = process.argv.slice(2);
const repo = "your-space-ai/your-space";
const api = `repos/${repo}`;

function finish(code, { out = "", err = "" } = {}) {
  save();
  process.stdout.write(out);
  process.stderr.write(err);
  process.exit(code);
}
const unsupported = () => finish(2, { err: `fake GitHub doesn't know: ${tool} ${args.join(" ")}\n` });

/** An injected failure for this call, if one is left. */
function injected(call) {
  const failure = state.fail?.find(entry => call.startsWith(entry.call) && entry.times > 0);
  if (failure) failure.times--;
  return failure;
}

const asset = (release, name) => release.assets.find(item => item.name === name);
const content = item => readFileSync(join(dir, "assets", String(item.id)));
function addAsset(release, name, data, assetState = "uploaded") {
  const id = ++state.lastId;
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "assets", String(id)), data);
  release.assets.push({ id, name, state: assetState, size: data.length });
}
// gh finds a release by its tag, a draft's included; the public download address serves only a
// published release's uploaded files.
const byTag = tag => state.releases.find(release => release.tag_name === tag && !release.draft) ?? state.releases.find(release => release.tag_name === tag);

// The jq expressions the script uses, as gh's built-in jq evaluates them.
const jq = {
  ".sha": value => [value.sha],
  ".id": value => [value.id],
  '.[] | select(.tag_name == "alpha") | "\\(.draft) \\(.id)"': value => value.filter(release => release.tag_name === "alpha").map(release => `${release.draft} ${release.id}`),
  '.[] | "\\(.id) \\(.state) \\(.name)"': value => value.map(item => `${item.id} ${item.state} ${item.name}`),
};

function ghApi() {
  let path;
  let method = "GET";
  let filter;
  let silent = false;
  const fields = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--paginate") continue;
    else if (arg === "--silent") silent = true;
    else if (arg === "--method") method = args[++i];
    else if (arg === "--jq") filter = args[++i];
    else if (arg === "-f" || arg === "-F") {
      const [key, ...rest] = args[++i].split("=");
      const value = rest.join("=");
      fields[key] = arg === "-F" && ["true", "false"].includes(value) ? value === "true" : value;
    } else if (!arg.startsWith("-") && path === undefined) path = arg;
    else return unsupported();
  }
  const call = `gh api ${method} ${path}`;
  state.calls.push(method === "GET" ? call : `${call} ${JSON.stringify(fields)}`);
  const failure = injected(call);
  if (failure && !failure.apply) return finish(1, { err: `gh: Server error (HTTP ${failure.status})\n` });

  let result;
  let match;
  const missing = () => finish(1, { out: '{"message":"Not Found"}', err: "gh: Not Found (HTTP 404)\n" });
  if (method === "GET" && (match = /^repos\/[^/]+\/[^/]+\/commits\/(.+)$/.exec(path))) {
    if (!state.commits[match[1]]) return missing();
    result = { sha: state.commits[match[1]] };
  } else if (method === "GET" && path === `${api}/releases?per_page=100`) {
    result = state.releases;
  } else if (method === "POST" && path === `${api}/releases`) {
    if (state.releases.some(release => release.tag_name === fields.tag_name)) {
      return finish(1, { out: '{"message":"Validation Failed","errors":[{"code":"already_exists","field":"tag_name"}]}', err: "gh: Validation Failed (HTTP 422)\n" });
    }
    result = { id: ++state.lastId, draft: false, prerelease: false, assets: [], ...fields };
    state.releases.push(result);
  } else if (method === "PATCH" && (match = new RegExp(`^${api}/releases/(\\d+)$`).exec(path))) {
    result = state.releases.find(release => release.id === Number(match[1]));
    if (!result) return missing();
    Object.assign(result, fields);
  } else if (method === "GET" && (match = new RegExp(`^${api}/releases/(\\d+)/assets\\?per_page=100$`).exec(path))) {
    const release = state.releases.find(item => item.id === Number(match[1]));
    if (!release) return missing();
    result = release.assets;
  } else if (method === "DELETE" && (match = new RegExp(`^${api}/releases/assets/(\\d+)$`).exec(path))) {
    const release = state.releases.find(item => item.assets.some(file => file.id === Number(match[1])));
    if (!release) return missing();
    release.assets = release.assets.filter(file => file.id !== Number(match[1]));
    result = "";
  } else return unsupported();

  if (failure) return finish(1, { err: `gh: Server error (HTTP ${failure.status})\n` });
  if (silent || result === "") return finish(0);
  if (filter === undefined) return finish(0, { out: JSON.stringify(result) });
  if (!jq[filter]) return unsupported();
  return finish(0, { out: jq[filter](result).map(line => `${line}\n`).join("") });
}

function ghRelease() {
  const [command, tag, ...rest] = args;
  const patterns = [];
  const files = [];
  let into;
  let output;
  let clobber = false;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--repo") { if (rest[++i] !== repo) return unsupported(); }
    else if (arg === "--pattern") patterns.push(rest[++i]);
    else if (arg === "--dir") into = rest[++i];
    else if (arg === "--output") output = rest[++i];
    else if (arg === "--clobber") clobber = true;
    else if (!arg.startsWith("-")) files.push(arg);
    else return unsupported();
  }
  const call = `gh release ${command} ${tag}`;
  state.calls.push(`${call} ${[...patterns, ...files.map(file => basename(file))].join(" ")}`);
  const failure = injected(call);
  if (failure && !failure.apply) return finish(1, { err: `HTTP ${failure.status}: Server Error (https://api.github.com/${api}/releases)\n` });
  const release = byTag(tag);
  if (!release) return finish(1, { err: "release not found\n" });

  if (command === "download") {
    if (!clobber || files.length) return unsupported();
    const found = release.assets.filter(item => item.state === "uploaded" && patterns.includes(item.name));
    if (!found.length) return finish(1, { err: "no assets match the file pattern\n" });
    if (output !== undefined) {
      if (found.length !== 1 || into !== undefined) return unsupported();
      writeFileSync(output, content(found[0]));
    } else {
      if (into === undefined) return unsupported();
      for (const item of found) writeFileSync(join(into, item.name), content(item));
    }
  } else if (command === "upload") {
    if (patterns.length || into !== undefined || output !== undefined || !files.length) return unsupported();
    for (const file of files) {
      const name = basename(file);
      const held = asset(release, name);
      // GitHub refuses a name a half-uploaded file still holds, and gh's --clobber replaces only an
      // uploaded one.
      if (held && (held.state !== "uploaded" || !clobber)) {
        return finish(1, { err: `HTTP 422: Validation Failed (https://uploads.github.com/${api}/releases/${release.id}/assets?name=${name})\nname already_exists\n` });
      }
      if (held) release.assets = release.assets.filter(item => item !== held);
      addAsset(release, name, readFileSync(file));
    }
  } else return unsupported();
  if (failure) return finish(1, { err: `HTTP ${failure.status}: Server Error (https://api.github.com/${api}/releases)\n` });
  return finish(0);
}

function curl() {
  let output;
  let format;
  let url;
  const flags = ["--silent", "--show-error", "--location"];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (flags.includes(arg)) continue;
    else if (arg === "--proto") { if (args[++i] !== "=https") return unsupported(); }
    else if (arg === "--max-time") i++;
    else if (arg === "--output") output = args[++i];
    else if (arg === "--write-out") format = args[++i];
    else if (!arg.startsWith("-") && url === undefined) url = arg;
    else return unsupported();
  }
  if (output === undefined || format !== "%{http_code}") return unsupported();
  state.calls.push(`curl ${url}`);
  const failure = injected(`curl ${url}`);
  let status = 404;
  let body = "Not Found";
  const served = state.served?.shift();
  const match = /^https:\/\/github\.com\/your-space-ai\/your-space\/releases\/download\/([^/]+)\/([^/]+)$/.exec(url);
  if (!match) return unsupported();
  if (failure) ({ status, body } = { status: failure.status, body: "Server Error" });
  else if (served) ({ status, body } = served);
  else {
    const release = state.releases.find(item => item.tag_name === match[1] && !item.draft);
    const item = release && asset(release, match[2]);
    if (item?.state === "uploaded") ({ status, body } = { status: 200, body: content(item) });
  }
  writeFileSync(output, body);
  return finish(0, { out: String(status) });
}

if (tool === "gh" && args[0] === "api") { args.shift(); ghApi(); }
else if (tool === "gh" && args[0] === "release") { args.shift(); ghRelease(); }
else if (tool === "curl") curl();
else if (tool === "sleep") { state.slept.push(Number(args[0])); finish(0); }
else unsupported();
