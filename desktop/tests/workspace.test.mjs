import assert from 'node:assert/strict';
import test from 'node:test';
import { access, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkWorkspace, createSavedWorkspaces, linkTarget, mostRecent, openedSaved, ownerDestination, parseSaved, removedSaved, renamedSaved, savedLimit, savedName, webDestination, workspaceOrigin, workspacePartition } from '../src/workspace.mjs';

test('only HTTPS and loopback HTTP origins are accepted and a workspace has its own session partition', () => {
  for (const address of ['https://workspace.example.com', 'http://127.0.0.1:3001', 'http://[::1]', 'http://space.localhost', 'http://space.localhost:8081']) {
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

test('a failed probe of localhost or 127.0.0.1 names the space.localhost address a local workspace answers at', async () => {
  // A local workspace's Caddy sends localhost and 127.0.0.1 to space.localhost, a redirect the probe refuses.
  const server = createServer((req, res) => res.writeHead(302, {Location: 'http://space.localhost:' + server.address().port + req.url}).end());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const {port} = server.address();
  try {
    for (const host of ['127.0.0.1', 'localhost']) {
      await assert.rejects(checkWorkspace(`http://${host}:${port}`, fetch), {
        code: 'local_address',
        message: `Could not reach a workspace at http://${host}:${port}. A workspace on this computer answers at http://space.localhost:${port} instead; connect to that address.`,
      });
    }
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
  await assert.rejects(checkWorkspace('http://[::1]', async () => {throw Error('refused');}), {code: 'local_address', message: /answers at http:\/\/space\.localhost instead/});
  for (const origin of ['http://space.localhost:8081', 'https://localhost:8443']) {
    await assert.rejects(checkWorkspace(origin, async () => {throw Error('refused');}), {code: 'unreachable'});
  }
});

async function folder(t) {
  const dir = await mkdtemp(join(tmpdir(), 'workspace-test-'));
  t.after(() => rm(dir, {recursive:true, force:true}));
  return {file: join(dir, 'workspaces.json'), legacyFile: join(dir, 'connection.json')};
}

test('a saved workspace is a valid address and a name, which defaults to the host or This Mac', () => {
  assert.equal(savedName('', 'https://space.example.com'), 'space.example.com');
  assert.equal(savedName(undefined, 'http://space.localhost:8090'), 'space.localhost:8090');
  assert.equal(savedName('  ', 'http://space.localhost:8081', true), 'This Mac');
  assert.equal(savedName('  Home server ', 'https://space.example.com'), 'Home server');
  for (const name of ['a'.repeat(101), 'two\nlines', 'tab\there', 'bidi\u202eflip', 42]) {
    assert.throws(() => savedName(name, 'https://space.example.com'), {code: 'invalid_name'});
  }
  assert.throws(() => savedName('Home', 'https://space.example.com/reset-password#token=t'), {code: 'invalid_address'});

  // Entries read from disk keep only valid addresses, each once, and fall back to the default name.
  assert.deepEqual(parseSaved({workspaces: [
    {origin: 'https://space.example.com/', name: 'Home server', lastOpened: 5},
    {origin: 'https://SPACE.example.com', name: 'Duplicate', lastOpened: 9},
    {origin: 'http://server.lan', name: 'Plain HTTP elsewhere'},
    {origin: 'https://a.test/?token=1', name: 'With a query'},
    {origin: 'http://space.localhost:8081', name: 'x\u0000', local: true, lastOpened: -1},
    {origin: 'https://other.example.com', name: 7, local: 'yes', lastOpened: 1.5},
    null, 'https://string.example.com',
  ]}), [
    {name: 'Home server', origin: 'https://space.example.com', local: false, lastOpened: 5},
    {name: 'This Mac', origin: 'http://space.localhost:8081', local: true, lastOpened: 0},
    {name: 'other.example.com', origin: 'https://other.example.com', local: false, lastOpened: 0},
  ]);
  for (const data of [null, {}, {workspaces: 'none'}, []]) assert.deepEqual(parseSaved(data), []);
  assert.equal(parseSaved({workspaces: Array.from({length: savedLimit + 5}, (_, i) => ({origin: `https://s${i}.example.com`}))}).length, savedLimit);
});

test('the list keeps the order workspaces were added, and launch opens the one used last', () => {
  let list = [];
  list = openedSaved(list, {origin: 'https://one.example.com'}, 10);
  list = openedSaved(list, {origin: 'http://space.localhost:8081', local: true}, 20);
  list = openedSaved(list, {origin: 'https://two.example.com', name: 'Two'}, 30);
  assert.deepEqual(list.map(entry => entry.name), ['one.example.com', 'This Mac', 'Two']);
  assert.equal(mostRecent(list).name, 'Two');

  // Opening a saved address again keeps its place and name unless a new name is given.
  list = openedSaved(list, {origin: 'https://one.example.com/', name: ' '}, 40);
  assert.deepEqual(list.map(entry => [entry.name, entry.lastOpened]), [['one.example.com', 40], ['This Mac', 20], ['Two', 30]]);
  assert.equal(mostRecent(list).origin, 'https://one.example.com');
  list = openedSaved(list, {origin: 'https://one.example.com', name: 'Office'}, 41);
  assert.equal(list[0].name, 'Office');

  // This Mac stays This Mac when its address is also entered by hand.
  list = openedSaved(list, {origin: 'http://space.localhost:8081'}, 50);
  assert.deepEqual(list[1], {name: 'This Mac', origin: 'http://space.localhost:8081', local: true, lastOpened: 50});

  list = renamedSaved(list, 'https://two.example.com', 'Home server');
  assert.equal(list[2].name, 'Home server');
  assert.equal(renamedSaved(list, 'https://two.example.com', '').at(2).name, 'two.example.com');
  assert.equal(renamedSaved(list, 'http://space.localhost:8081', '')[1].name, 'This Mac');
  assert.throws(() => renamedSaved(list, 'https://missing.example.com', 'Name'), {code: 'not_saved'});
  assert.throws(() => renamedSaved(list, 'https://two.example.com', 'a'.repeat(101)), {code: 'invalid_name'});
  assert.deepEqual(removedSaved(list, 'https://office.example.com'.replace('office', 'one')).map(entry => entry.name), ['This Mac', 'Home server']);
  assert.throws(() => removedSaved(list, 'https://missing.example.com'), {code: 'not_saved'});
  assert.equal(mostRecent([]), null);
  assert.equal(mostRecent([{origin: 'https://a.example.com', lastOpened: 0}, {origin: 'https://b.example.com', lastOpened: 0}]).origin, 'https://a.example.com');
});

test('past the limit, adding a workspace forgets the one opened longest ago, never This Mac first', () => {
  let list = openedSaved([], {origin: 'http://space.localhost:8081', local: true}, 1);
  for (let i = 1; i < savedLimit; i++) list = openedSaved(list, {origin: `https://s${i}.example.com`}, 100 + i);
  list = openedSaved(list, {origin: 'https://s1.example.com'}, 1000);
  assert.equal(list.length, savedLimit);
  list = openedSaved(list, {origin: 'https://new.example.com'}, 2000);
  assert.equal(list.length, savedLimit);
  assert.equal(list[0].local, true);
  assert.equal(list.some(entry => entry.origin === 'https://s2.example.com'), false);
  assert.equal(list.at(-1).origin, 'https://new.example.com');
});

test('the saved list is written privately and atomically, and changes run one at a time', async t => {
  const {file, legacyFile} = await folder(t);
  let time = 100;
  const changes = [];
  const store = createSavedWorkspaces({file, legacyFile, now: () => time++, onChange: list => changes.push(list.length)});
  assert.deepEqual(await store.list(), []);
  await Promise.all([
    store.opened('https://one.example.com', {name: 'One'}),
    store.opened('http://space.localhost:8081', {local: true}),
    store.opened('https://two.example.com'),
  ]);
  assert.deepEqual(changes, [1, 2, 3]);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), {workspaces: [
    {name: 'One', origin: 'https://one.example.com', local: false, lastOpened: 100},
    {name: 'This Mac', origin: 'http://space.localhost:8081', local: true, lastOpened: 101},
    {name: 'two.example.com', origin: 'https://two.example.com', local: false, lastOpened: 102},
  ]});
  await store.rename('https://two.example.com', 'Home server');
  await store.remove('https://one.example.com');
  await assert.rejects(store.opened('http://space.localhost/reset-password#token=demo'), {code: 'invalid_address'});
  await assert.rejects(store.rename('https://one.example.com', 'Gone'), {code: 'not_saved'});
  assert.equal((await readFile(file, 'utf8')).includes('token'), false);
  assert.deepEqual(store.current().map(entry => entry.name), ['This Mac', 'Home server']);

  // A fresh start reads the same list; a damaged file reads as empty and is replaced on the next change.
  const again = createSavedWorkspaces({file, legacyFile});
  assert.deepEqual((await again.list()).map(entry => entry.name), ['This Mac', 'Home server']);
  await writeFile(file, 'invalid');
  const damaged = createSavedWorkspaces({file, legacyFile, now: () => 5});
  assert.deepEqual(await damaged.list(), []);
  await damaged.opened('https://three.example.com');
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')).workspaces.map(entry => entry.origin), ['https://three.example.com']);
});

test('the single address earlier versions saved becomes the first entry, once', async t => {
  const {file, legacyFile} = await folder(t);
  await writeFile(legacyFile, JSON.stringify({origin: 'http://space.localhost:8081', local: true}));
  const store = createSavedWorkspaces({file, legacyFile, now: () => 42});
  assert.deepEqual(await store.list(), [{name: 'This Mac', origin: 'http://space.localhost:8081', local: true, lastOpened: 42}]);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  await assert.rejects(access(legacyFile), {code: 'ENOENT'});

  // A server address migrates with its host as its name; an existing list is never replaced.
  const second = await folder(t);
  await writeFile(second.legacyFile, JSON.stringify({origin: 'https://space.example.com', local: false}));
  assert.deepEqual(await createSavedWorkspaces({...second, now: () => 7}).list(),
    [{name: 'space.example.com', origin: 'https://space.example.com', local: false, lastOpened: 7}]);
  await writeFile(second.legacyFile, JSON.stringify({origin: 'https://other.example.com', local: false}));
  assert.deepEqual((await createSavedWorkspaces(second).list()).map(entry => entry.origin), ['https://space.example.com']);

  // An invalid or missing legacy file leaves an empty list.
  const third = await folder(t);
  await writeFile(third.legacyFile, JSON.stringify({origin: 'http://server.lan', local: false}));
  assert.deepEqual(await createSavedWorkspaces(third).list(), []);
  assert.deepEqual(await createSavedWorkspaces(await folder(t)).list(), []);
});
