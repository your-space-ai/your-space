// Runs the actual Electron windows, either from source or from an extracted Mac candidate.
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { builtInThemes, defaultThemeId } from "../../shared/appearance/theme.mjs";
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { expect } from '@playwright/test';
import { launchDesktop } from './launch-desktop.mjs';

const desktop = fileURLToPath(new URL('..', import.meta.url));

async function fixture() {
  const server = createServer((req, res) => {
    if (req.url === '/api/status') {
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({owner:true}));
    } else {
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
      res.end('<h1>Test workspace</h1><a href="/app" target="_blank" rel="noopener">Open test app</a>');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {server, origin: 'http://127.0.0.1:' + server.address().port};
}

test('native launcher opens a workspace, isolates its app, saves it and reopens it', {timeout: 150_000}, async () => {
  const userData = await mkdtemp(join(tmpdir(), 'your-space-native-'));
  const {server, origin} = await fixture();
  const launch = () => launchDesktop(desktop,userData);
  let client;
  try {
    client = await launch();
    const launcher = await client.firstWindow();
    await launcher.getByRole('button', {name: /Connect to a server/i}).click();
    await launcher.getByLabel('Server address').fill(origin);

    const opened = client.waitForEvent('window');
    await launcher.getByRole('button', {name:'Connect', exact:true}).click();
    const workspace = await opened;
    await expect(workspace.getByRole('heading', {name:'Test workspace'})).toBeVisible();
    assert.equal(await workspace.evaluate(() => typeof window.yourSpace), 'undefined');
    assert.equal(await workspace.evaluate(() => typeof window.require), 'undefined');
    const newTab = client.waitForEvent('window');
    await workspace.getByRole('link', {name:'Open test app'}).click();
    const child = await newTab;
    await expect(child).toHaveURL(origin + '/app');
    assert.equal(await child.evaluate(() => typeof window.yourSpace), 'undefined');
    // The address is saved with its host as its name.
    const saved = JSON.parse(await readFile(join(userData, 'connections.json'), 'utf8'));
    assert.deepEqual(saved.connections.map(({name, origin, local}) => ({name, origin, local})), [{name: new URL(origin).host, origin, local:false}]);
    assert.ok(Number.isSafeInteger(saved.connections[0].lastOpened));
    // From source, Playwright also reaches the main process: closing the workspace window keeps the app
    // running with the window hidden, the Dock icon shows it again, and the app menu offers updates.
    if (typeof client.evaluate === 'function') {
      const windows = () => client.evaluate(({BrowserWindow}, address) => BrowserWindow.getAllWindows()
        .map(win => ({url: win.webContents.getURL(), visible: win.isVisible()})).filter(win => win.url.startsWith(address)), origin);
      await child.close();
      await client.evaluate(({BrowserWindow}, address) => BrowserWindow.getAllWindows()
        .find(win => win.webContents.getURL() === address + '/').close(), origin);
      await expect.poll(windows).toEqual([{url: origin + '/', visible: false}]);
      await client.evaluate(({app}) => app.emit('activate'));
      await expect.poll(windows).toEqual([{url: origin + '/', visible: true}]);
      const menu = await client.evaluate(({Menu}) => Menu.getApplicationMenu().items[0].submenu.items
        .filter(item => /Update/.test(item.label)).map(({label, type, checked, submenu}) => ({label, type, checked,
          ...(submenu ? {submenu: submenu.items.map(({label, type, checked}) => ({label, type, checked}))} : {})})));
      // A release build with no channel stored follows Alpha.
      assert.deepEqual(menu, [
        {label:'Check for Updates…', type:'normal', checked:false},
        {label:'Check for Updates Automatically', type:'checkbox', checked:false},
        {label:'Update Channel', type:'submenu', checked:false, submenu:[
          {label:'Alpha', type:'radio', checked:true}, {label:'Canary', type:'radio', checked:false},
        ]},
      ]);
      assert.deepEqual(JSON.parse(await readFile(join(userData, 'updates.json'), 'utf8')), {automatic:false, channel:'alpha'});
      // The Connections menu lists the saved connection on ⌘1, then adding a server and the launcher's list.
      const connectionMenu = await client.evaluate(({Menu}) => Menu.getApplicationMenu().items
        .find(item => item.label === 'Connections').submenu.items.map(({label, type, accelerator}) => ({label, type, accelerator})));
      assert.deepEqual(connectionMenu.filter(item => item.type !== 'separator').map(item => item.label).slice(0, 3),
        [new URL(origin).host, 'Add a server…', 'Manage connections…']);
      assert.equal(connectionMenu[0].accelerator, 'CmdOrCtrl+1');
    }
    await client.close();
    client = await launch();
    const reopened = await client.firstWindow();
    await expect(reopened.getByRole('heading', {name:'Test workspace'})).toBeVisible();
    await expect(reopened).toHaveURL(origin + '/');
  } finally {
    if (client) await client.close().catch(() => {});
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(userData, {recursive:true, force:true});
  }
});

test('an address saved by an earlier version reopens, and saved connections open side by side', {timeout: 150_000}, async () => {
  const userData = await mkdtemp(join(tmpdir(), 'your-space-saved-'));
  const first = await fixture();
  const second = await fixture();
  let client;
  try {
    // Earlier versions kept one address in connection.json; it becomes the first saved connection.
    await writeFile(join(userData, 'connection.json'), JSON.stringify({origin: first.origin, local: false}));
    client = await launchDesktop(desktop, userData);
    const reopened = await client.firstWindow();
    await expect(reopened.getByRole('heading', {name:'Test workspace'})).toBeVisible();
    await expect(reopened).toHaveURL(first.origin + '/');
    const saved = async () => JSON.parse(await readFile(join(userData, 'connections.json'), 'utf8')).connections
      .map(({name, origin, local}) => ({name, origin, local}));
    assert.deepEqual(await saved(), [{name: new URL(first.origin).host, origin: first.origin, local: false}]);
    await assert.rejects(access(join(userData, 'connection.json')), {code: 'ENOENT'});
    // The rest drives the Connections menu, which only a run from source can reach.
    if (typeof client.evaluate !== 'function') return;

    const menu = label => client.evaluate(({Menu}, label) => Menu.getApplicationMenu().items
      .find(item => item.label === 'Connections').submenu.items.find(item => item.label === label).click(), label);
    const windows = () => client.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()
      .map(win => ({url: win.webContents.getURL(), visible: win.isVisible()})).filter(win => win.url.startsWith('http'))
      .sort((a, b) => a.url.localeCompare(b.url)));
    const shown = client.waitForEvent('window');
    await menu('Add a server…');
    const launcher = await shown;
    await expect(launcher.getByRole('heading', {name: 'Connect to a server'})).toBeFocused();
    await launcher.getByLabel('Server address').fill(second.origin);
    await launcher.getByLabel('Name (optional)').fill('Second');
    const opened = client.waitForEvent('window');
    await launcher.getByRole('button', {name: 'Connect', exact: true}).click();
    await expect((await opened).getByRole('heading', {name: 'Test workspace'})).toBeVisible();
    assert.deepEqual(await saved(), [
      {name: new URL(first.origin).host, origin: first.origin, local: false},
      {name: 'Second', origin: second.origin, local: false},
    ]);
    const labels = await client.evaluate(({Menu}) => Menu.getApplicationMenu().items.find(item => item.label === 'Connections')
      .submenu.items.slice(0, 2).map(({label, accelerator}) => ({label, accelerator})));
    assert.deepEqual(labels, [{label: new URL(first.origin).host, accelerator: 'CmdOrCtrl+1'}, {label: 'Second', accelerator: 'CmdOrCtrl+2'}]);

    // Each connection keeps one window: choosing one in the menu shows it again rather than opening another.
    await client.evaluate(({BrowserWindow}, address) => BrowserWindow.getAllWindows()
      .find(win => win.webContents.getURL() === address + '/').close(), first.origin);
    await expect.poll(windows).toEqual([first, second].map(({origin}) => ({url: origin + '/', visible: origin === second.origin}))
      .sort((a, b) => a.url.localeCompare(b.url)));
    await menu(new URL(first.origin).host);
    await expect.poll(windows).toEqual([first, second].map(({origin}) => ({url: origin + '/', visible: true}))
      .sort((a, b) => a.url.localeCompare(b.url)));

    // Manage connections… shows the list, where a connection is renamed or forgotten.
    await menu('Manage connections…');
    await expect(launcher.getByRole('heading', {name: 'Open a connection'})).toBeVisible();
    await launcher.getByRole('button', {name: 'Rename or remove Second'}).click();
    await launcher.getByLabel('Name', {exact: true}).fill('Studio');
    await launcher.getByRole('button', {name: 'Save'}).click();
    await expect(launcher.getByRole('button', {name: 'Rename or remove Studio'})).toBeFocused();
    assert.equal((await saved())[1].name, 'Studio');
    await client.evaluate(({BrowserWindow}, address) => BrowserWindow.getAllWindows()
      .find(win => win.webContents.getURL() === address + '/').close(), second.origin);
    await launcher.getByRole('button', {name: 'Rename or remove Studio'}).click();
    await launcher.getByRole('button', {name: 'Remove…'}).click();
    await launcher.getByRole('button', {name: 'Remove', exact: true}).click();
    await expect(launcher.getByRole('listitem')).toHaveCount(1);
    // Forgetting a connection closes its hidden window and leaves the other open.
    await expect.poll(windows).toEqual([{url: first.origin + '/', visible: true}]);
    assert.deepEqual((await saved()).map(entry => entry.origin), [first.origin]);
  } finally {
    if (client) await client.close().catch(() => {});
    for (const {server} of [first, second]) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    await rm(userData, {recursive:true, force:true});
  }
});

test('a packaged launcher shows the default theme and offers no theme of its own', {timeout: 90_000}, async () => {
  const userData = await mkdtemp(join(tmpdir(), 'your-space-appearance-'));
  let client;
  try {
    client = await launchDesktop(desktop,userData);
    const launcher = await client.firstWindow();
    const background = () => launcher.evaluate(() => document.documentElement.style.getPropertyValue('--bg'));
    // The launcher shows the default theme's palette for the Mac's current appearance.
    const scheme = await launcher.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    await expect.poll(background).toBe(builtInThemes.find(entry => entry.id === defaultThemeId).theme[scheme].bg);
    await expect(launcher.getByRole('button', {name:'Appearance'})).toHaveCount(0);
  } finally {
    if (client) await client.close().catch(() => {});
    await rm(userData, {recursive:true, force:true});
  }
});
