import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { launcherAppearance } from '../src/appearance.mjs';
import { builtInThemes } from '../../shared/appearance/theme.mjs';

async function launcherFile(t) {
  const dir = await mkdtemp(join(tmpdir(), 'ys-appearance-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  return join(dir, 'launcher-theme.json');
}

test('launcher keeps a validated custom theme on this device across built-in choices', async t => {
  const file = await launcherFile(t);
  const appearance = launcherAppearance(file);
  const original = await appearance.get();
  assert.equal(original.selected, 'cerulean');
  assert.deepEqual(original.themes.map(t => t.id), ['cerulean', 'cinder', 'fern']);
  assert.equal(original.themes[0].dark.variables['--bg'], builtInThemes[0].theme.dark.bg);
  assert.deepEqual([original.themes[0].light.scheme, original.themes[0].dark.scheme], ['light', 'dark']);

  const theme = {...builtInThemes[2].theme, name: 'My palette'};
  const text = JSON.stringify(theme);
  assert.equal(appearance.preview(text).name, theme.name);
  for (const invalid of ['{}', 'x'.repeat(20000), JSON.stringify({...theme, javascript:'ignored?'}), JSON.stringify({...theme, version: 3})]) {
    assert.ok(appearance.preview(invalid).error);
    assert.ok((await appearance.save({id:'custom', text:invalid})).error);
  }
  assert.ok((await appearance.save({id:'custom'})).error);
  assert.ok((await appearance.save({id:'elsewhere', text})).error);
  const saved = await appearance.save({id:'custom', text});
  assert.equal(saved.selected, 'custom');
  assert.equal(saved.themes.at(-1).light.variables['--bg'], theme.light.bg);
  assert.equal(saved.themes.at(-1).dark.variables['--bg'], theme.dark.bg);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(file)).custom.name, theme.name);

  const other = await appearance.save({id:'cinder'});
  assert.equal(other.selected, 'cinder');
  const reopened = launcherAppearance(file);
  assert.equal((await reopened.get()).themes.at(-1).name, theme.name);
  assert.equal((await reopened.save({id:'custom'})).selected, 'custom');

  await writeFile(file, '{corrupt');
  assert.deepEqual(await reopened.get(), original);
});

test('launcher refuses version 1 files and opens on Cerulean when left on a retired starter', async t => {
  const file = await launcherFile(t);
  const appearance = launcherAppearance(file);
  const version1 = {version: 1, name: 'Harbor', scheme: 'light', tokens: {bg: '#eaf2f8', panel: '#fcfeff', fg: '#122c41',
    muted: '#466071', accent: '#17567d', accentInk: '#ffffff', border: '#abc3d2', danger: '#963e42', success: '#1b645f',
    fontBody: 'Avenir Next', fontHeading: 'Avenir Next'}};
  assert.ok(appearance.preview(JSON.stringify(version1)).error);
  assert.ok((await appearance.save({id: 'custom', text: JSON.stringify(version1)})).error);

  // Saved by an earlier launcher: a retired starter chosen, or a version 1 file imported.
  for (const saved of [{selected: 'ember'}, {selected: 'custom', custom: version1}]) {
    await writeFile(file, JSON.stringify(saved));
    const library = await appearance.get();
    assert.equal(library.selected, 'cerulean');
    assert.deepEqual(library.themes.map(theme => theme.id), ['cerulean', 'cinder', 'fern']);
  }
});
