// Runs the actual Electron windows, either from source or from an extracted Mac candidate.
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { starterThemes } from "../../shared/appearance/theme.mjs";
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

test('a packaged launcher previews, imports and remembers its own portable theme before sign-in', {timeout: 90_000}, async () => {
  const userData = await mkdtemp(join(tmpdir(), 'your-space-appearance-'));
  const launch = () => launchDesktop(desktop,userData);
  let client;
  try {
    client = await launch();
    const launcher = await client.firstWindow();
    const properties = () => launcher.evaluate(() => document.documentElement.style.getPropertyValue('--bg'));
    await launcher.getByRole('button', {name:'Appearance'}).click();
    await expect(launcher.getByRole('radio', {name:'Canopy'})).toBeChecked();
    for (const image of await launcher.locator('#theme-cards img').all()) {
      await expect.poll(() => image.evaluate(node => node.naturalWidth)).toBeGreaterThan(0);
    }
    await launcher.getByRole('radio', {name:'Ember'}).check();
    await expect.poll(properties).toBe(starterThemes[2].theme.tokens.bg);
    await launcher.getByRole('button', {name:'Cancel'}).click();
    await expect.poll(properties).toBe(starterThemes[0].theme.tokens.bg);
    await launcher.getByRole('button', {name:'Appearance'}).click();

    const file = launcher.getByLabel('Import a theme');
    await file.setInputFiles({name:'invalid.json', mimeType:'application/json', buffer:Buffer.from('{}')});
    await expect(launcher.locator('#theme-error')).toContainText('valid Your Space theme');
    const theme = {...starterThemes[1].theme, name:'Northern sky'};
    await file.setInputFiles({name:'custom.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify(theme))});
    await expect(launcher.getByRole('radio', {name:theme.name})).toBeChecked();
    await launcher.getByRole('button', {name:'Use theme'}).click();
    await expect(launcher.getByRole('dialog')).toHaveCount(0);
    assert.equal(JSON.parse(await readFile(join(userData, 'launcher-theme.json'))).custom.name, theme.name);

    await client.close();
    client = await launch();
    const reopened = await client.firstWindow();
    await reopened.getByRole('button', {name:'Appearance'}).click();
    await expect(reopened.getByRole('radio', {name:theme.name})).toBeChecked();
  } finally {
    if (client) await client.close().catch(() => {});
    await rm(userData, {recursive:true, force:true});
  }
});
