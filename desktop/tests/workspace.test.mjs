import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkWorkspace, lastWorkspace, linkTarget, ownerDestination, rememberWorkspace, webDestination, workspaceOrigin, workspacePartition } from '../src/workspace.mjs';

test('only HTTPS and loopback HTTP origins are accepted and a workspace has its own session partition', () => {
  for (const address of ['https://workspace.example.com', 'http://127.0.0.1:3001', 'http://[::1]', 'http://space.localhost']) {
    assert.equal(workspaceOrigin(address + '/'), address);
  }
  for (const address of ['file:///tmp', 'http://server.lan', 'http://localhost.example', 'https://user@host', 'https://a.test/reset-password#token=t', 'https://a.test/?', '//server.test']) {
    assert.throws(() => workspaceOrigin(address), {code: 'invalid_address'});
  }
  assert.equal(workspacePartition('https://space.example.com'), workspacePartition('HTTPS://Space.Example.com/'));
  assert.notEqual(workspacePartition('https://space.example.com'), workspacePartition('https://space.example.com:8081'));
  assert.equal(webDestination('file:///tmp/index.html'), false);
  assert.equal(linkTarget('http://app.example.com/task', 'https://space.example.com'), 'browser');
  assert.equal(linkTarget('http://my-app.localhost:8081/task', 'http://space.localhost:8081'), 'browser');
  assert.equal(linkTarget('https://app.example.com/task', 'https://space.example.com'), 'browser');
  assert.equal(linkTarget('http://user:secret@app.example.com'), 'deny');
  assert.equal(linkTarget('https://space.example.com/apps', 'https://space.example.com'), 'workspace');
  assert.equal(linkTarget('file:///tmp/index.html'), 'deny');
});

test('owner handoff stays on the exact local workspace reset route', () => {
  const origin = 'http://space.localhost:8012';
  const url = origin + '/reset-password#token=example';
  assert.equal(ownerDestination(origin, url), url);
  for (const wrong of [url.replace('8012', '8011'), url.replace('reset-password', 'apps'), url.replace('#', '?'),
    url.replace('http://', 'http://name@'), origin, origin + '/reset-password#token=']) {
    assert.throws(() => ownerDestination(origin, wrong), {code: 'owner_link'});
  }
});

test('connection probes accept only the status contract, without cookies or redirects', async () => {
  const origin = 'https://space.example.com';
  for (const owner of [true, false]) {
    assert.equal(await checkWorkspace(origin, async (url, options) => {
      assert.equal(url, origin + '/api/status');
      assert.equal(options.credentials, 'omit');
      assert.equal(options.redirect, 'error');
      return Response.json({owner});
    }), owner);
  }
  for (const response of [new Response('<p>ok</p>'), Response.json({status: 'ok'}), Response.json({owner:true,padding:'a'.repeat(4100)})]) {
    await assert.rejects(checkWorkspace(origin, async () => response), {code: 'unsupported_server'});
  }
  await assert.rejects(checkWorkspace(origin, async () => Response.json({}, {status:503})), {code: 'storage_unavailable'});
  await assert.rejects(checkWorkspace(origin, async () => {throw Error('private redirect or certificate details');}), {code: 'unreachable'});
});

test('only the chosen origin and setup mode survive relaunch', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'workspace-test-'));
  const file = join(dir, 'connection.json');
  try {
    assert.equal(await lastWorkspace(file), null);
    await rememberWorkspace(file, 'http://space.localhost', true);
    assert.deepEqual(await lastWorkspace(file), {origin: 'http://space.localhost', local:true});
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    await assert.rejects(rememberWorkspace(file, 'http://space.localhost/reset-password#token=demo'));
    assert.equal((await readFile(file, 'utf8')).includes('token'), false);
    await writeFile(file, 'invalid');
    assert.equal(await lastWorkspace(file), null);
  } finally { await rm(dir, {recursive:true, force:true}); }
});
