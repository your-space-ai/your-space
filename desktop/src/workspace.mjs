import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export class WorkspaceError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export function workspaceOrigin(value) {
  let url;
  try {
    if (typeof value === 'string' && value.length <= 2048) url = new URL(value.trim());
  } catch { /* handled below */ }
  if (!url || !isWorkspaceAddress(url) || url.username || url.password ||
      url.href !== url.origin + '/') {
    throw new WorkspaceError('invalid_address', 'Enter the server’s full HTTPS address, or an HTTP address on this computer, without a path, query or sign-in link.');
  }
  return url.origin;
}

function isWorkspaceAddress(url) {
  return url.protocol === 'https:' || (url.protocol === 'http:' &&
    (['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) || url.hostname.endsWith('.localhost')));
}

// A workspace on this computer answers only at space.localhost: its Caddy redirects localhost and
// 127.0.0.1 there, and the status probe follows no redirects.
function localWorkspaceAddress(origin) {
  const url = new URL(origin);
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)) return null;
  return 'http://space.localhost' + (url.port ? ':' + url.port : '');
}

export function webDestination(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
}

export function linkTarget(value, workspace) {
  if (!webDestination(value)) return 'deny';
  return new URL(value).origin === workspace ? 'workspace' : 'browser';
}

export function ownerDestination(origin, value) {
  let url;
  try { url = new URL(value); } catch { /* handled below */ }
  if (!url || !webDestination(url.href) || url.origin !== workspaceOrigin(origin) ||
      url.pathname !== '/reset-password' || url.search || !/^#token=[^&#\s]+$/u.test(url.hash)) {
    throw new WorkspaceError('owner_link', 'Your Space could not open the local owner link. Use the installation’s owner recovery command.');
  }
  return url.href;
}

export function workspacePartition(origin) {
  return 'persist:workspace-' + createHash('sha256').update(workspaceOrigin(origin)).digest('hex');
}

export async function checkWorkspace(origin, fetchStatus) {
  const signal = AbortSignal.timeout(8000);
  let response;
  const unsupported = () => new WorkspaceError('unsupported_server', 'This address did not return a Your Space workspace status. Check the server address.');
  try {
    response = await fetchStatus(workspaceOrigin(origin) + '/api/status', {
      redirect: 'error', credentials: 'omit', cache: 'no-store', signal,
      headers: { Accept: 'application/json' }
    });
    if (response.status === 503) throw new WorkspaceError('storage_unavailable', 'The server is reachable, but its storage is unavailable. Check the server and retry.');
    if (!response.ok || response.headers.get('content-type')?.split(';')[0].trim() !== 'application/json' || !response.body) throw unsupported();
    const chunks = [];
    let bytes = 0;
    for await (const chunk of response.body) {
      bytes += chunk.length;
      if (bytes > 4096) throw unsupported();
      chunks.push(chunk);
    }
    let status;
    try { status = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw unsupported(); }
    if (typeof status?.owner !== 'boolean') throw unsupported();
    return status.owner;
  } catch (error) {
    if (error instanceof WorkspaceError) throw error;
    const address = workspaceOrigin(origin);
    const local = localWorkspaceAddress(address);
    if (local) throw new WorkspaceError('local_address', `Could not reach a workspace at ${address}. A workspace on this computer answers at ${local} instead; connect to that address.`);
    throw new WorkspaceError('unreachable', 'Could not reach the workspace. Check its address, network connection and HTTPS certificate, then retry.');
  } finally {
    if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
  }
}

// Saved workspaces are a name and an address each, and nothing about how the server is reached: a
// tunnel, VPN or proxy is the network's job (decision 2026-11-24). The list keeps the order they
// were added, so the Workspace menu's ⌘1–⌘9 stay put; "most recent" only picks what opens on launch.
export const savedLimit = 50;
const localName = 'This Mac';

// The name shown for a saved address. Empty means the default: the address's host, or This Mac.
export function savedName(value, origin, local = false) {
  const address = workspaceOrigin(origin);
  if (value !== undefined && value !== null && typeof value !== 'string') throw invalidName();
  const name = (value ?? '').trim();
  if (!name) return local ? localName : new URL(address).host;
  if (name.length > 100 || /[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(name)) throw invalidName();
  return name;
}

function invalidName() {
  return new WorkspaceError('invalid_name', 'Enter a name of up to 100 characters on one line, or leave it empty.');
}

// Keeps the valid entries of a list read from disk, each address once, up to the limit.
export function parseSaved(data) {
  const list = [];
  for (const item of Array.isArray(data?.workspaces) ? data.workspaces : []) {
    let origin;
    try { origin = workspaceOrigin(item?.origin); } catch { continue; }
    if (list.some(entry => entry.origin === origin)) continue;
    const local = item.local === true;
    let name;
    try { name = savedName(item.name, origin, local); } catch { name = savedName('', origin, local); }
    const lastOpened = Number.isSafeInteger(item.lastOpened) && item.lastOpened > 0 ? item.lastOpened : 0;
    list.push({name, origin, local, lastOpened});
    if (list.length === savedLimit) break;
  }
  return list;
}

// Records a successful open: a new address goes to the end of the list, a saved one keeps its place.
// `local` marks the app's own installation and stays set, so connecting to the same address by hand
// doesn't make This Mac a plain server. Past the limit, the entry opened longest ago goes, This Mac last.
export function openedSaved(list, {origin, name, local = false}, time) {
  origin = workspaceOrigin(origin);
  const index = list.findIndex(entry => entry.origin === origin);
  if (index >= 0) {
    const entry = list[index];
    const marked = entry.local || local;
    // An empty name keeps the one already saved.
    const given = typeof name === 'string' ? name.trim() : name;
    return list.with(index, {...entry, local: marked, lastOpened: time, name: given ? savedName(given, origin, marked) : entry.name});
  }
  const next = [...list, {name: savedName(name, origin, local), origin, local, lastOpened: time}];
  if (next.length <= savedLimit) return next;
  const candidates = next.slice(0, -1);
  const pool = candidates.some(entry => !entry.local) ? candidates.filter(entry => !entry.local) : candidates;
  const oldest = pool.reduce((a, b) => b.lastOpened < a.lastOpened ? b : a);
  return next.filter(entry => entry !== oldest);
}

export function renamedSaved(list, origin, name) {
  origin = workspaceOrigin(origin);
  const index = list.findIndex(entry => entry.origin === origin);
  if (index < 0) throw notSaved();
  return list.with(index, {...list[index], name: savedName(name, origin, list[index].local)});
}

// Forgets an address. Nothing on its server, or in the installation on this Mac, changes.
export function removedSaved(list, origin) {
  origin = workspaceOrigin(origin);
  if (!list.some(entry => entry.origin === origin)) throw notSaved();
  return list.filter(entry => entry.origin !== origin);
}

function notSaved() {
  return new WorkspaceError('not_saved', 'This workspace is no longer in your list.');
}

// The workspace to open on launch: the one opened last, or the first saved when none has a time.
export function mostRecent(list) {
  return list.reduce((best, entry) => !best || entry.lastOpened > best.lastOpened ? entry : best, null);
}

// Records that a saved workspace was used, as when its window comes to the front, so launch opens it.
// An address that isn't saved stays off the list, and the list is unchanged when it is already the most recent.
export function usedSaved(list, origin, time) {
  origin = workspaceOrigin(origin);
  const index = list.findIndex(entry => entry.origin === origin);
  if (index < 0 || mostRecent(list) === list[index]) return list;
  return list.with(index, {...list[index], lastOpened: time});
}

async function writePrivate(file, contents) {
  await mkdir(dirname(file), {recursive: true, mode: 0o700});
  const temporary = file + '.' + randomUUID();
  try {
    await writeFile(temporary, contents, {flag: 'wx', mode: 0o600});
    await rename(temporary, file);
  } finally {
    await rm(temporary, {force: true});
  }
}

// The saved list in `file`, written whole and atomically, readable only by this user. On first use it
// takes over the single address earlier versions kept in `legacyFile`, then deletes that file.
// Changes run one at a time, and one that changes nothing isn't written; `onChange` follows each one
// that is. A list that can't be read isn't taken as empty: reading, and every change, fails until it
// can be, so no write replaces it.
export function createSavedWorkspaces({file, legacyFile, now = Date.now, onChange = () => {}}) {
  let list = [];
  let loaded = false;
  let queue = Promise.resolve();

  // A file that is missing or holds no list reads as empty; any other failure to read it is an error.
  async function read(path) {
    try { return await readFile(path, 'utf8'); } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async function load() {
    const text = await read(file);
    if (text === null) return migrate();
    try { return parseSaved(JSON.parse(text)); } catch { return []; }
  }

  async function migrate() {
    const text = legacyFile ? await read(legacyFile) : null;
    if (text === null) return [];
    let origin;
    let local;
    try {
      const saved = JSON.parse(text);
      origin = workspaceOrigin(saved?.origin);
      local = saved.local === true;
    } catch { return []; }
    const migrated = openedSaved([], {origin, local}, now());
    await writePrivate(file, JSON.stringify({workspaces: migrated}));
    await rm(legacyFile, {force: true});
    return migrated;
  }

  function serial(change) {
    const run = queue.then(async () => {
      if (!loaded) {
        list = await load();
        loaded = true;
      }
      if (!change) return list;
      const next = change(list);
      if (next === list) return list;
      await writePrivate(file, JSON.stringify({workspaces: next}));
      list = next;
      try { onChange(list); } catch { /* A listener's failure doesn't undo the change. */ }
      return list;
    });
    queue = run.catch(() => {});
    return run;
  }

  return {
    /** The saved list, loading it the first time. */
    list: () => serial(),
    /** The list as last loaded or written, for code that can't wait, such as building a menu. */
    current: () => list,
    opened: (origin, {name, local} = {}) => serial(value => openedSaved(value, {origin, name, local}, now())),
    used: origin => serial(value => usedSaved(value, origin, now())),
    rename: (origin, name) => serial(value => renamedSaved(value, origin, name)),
    remove: origin => serial(value => removedSaved(value, origin)),
  };
}
