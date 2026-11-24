// Runs the actual Electron windows, either from source or from an extracted Mac candidate.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
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

test('native launcher opens a workspace, isolates its app and reopens the saved address', {timeout: 150_000}, async () => {
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
    assert.deepEqual(JSON.parse(await readFile(join(userData, 'connection.json'), 'utf8')), {origin, local:false});
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
        .filter(item => /Update/.test(item.label)).map(({label, type, checked}) => ({label, type, checked})));
      assert.deepEqual(menu, [
        {label:'Check for Updates…', type:'normal', checked:false},
        {label:'Check for Updates Automatically', type:'checkbox', checked:false},
      ]);
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
