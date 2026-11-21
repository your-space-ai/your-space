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
    throw new WorkspaceError('unreachable', 'Could not reach the workspace. Check its address, network connection and HTTPS certificate, then retry.');
  } finally {
    if (response?.body && !response.body.locked) await response.body.cancel().catch(() => {});
  }
}

export async function lastWorkspace(file) {
  try {
    const saved = JSON.parse(await readFile(file, 'utf8'));
    return { origin: workspaceOrigin(saved.origin), local: saved.local === true };
  }
  catch { return null; }
}

export async function rememberWorkspace(file, origin, local = false) {
  const contents = JSON.stringify({origin: workspaceOrigin(origin), local});
  await mkdir(dirname(file), {recursive: true, mode: 0o700});
  const temporary = file + '.' + randomUUID();
  try {
    await writeFile(temporary, contents, {flag: 'wx', mode: 0o600});
    await rename(temporary, file);
  } finally {
    await rm(temporary, {force: true});
  }
}
