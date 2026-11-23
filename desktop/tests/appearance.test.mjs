import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { launcherAppearance } from '../src/appearance.mjs';
import { builtInThemes, retiredStarterThemes, validateTheme } from '../../shared/appearance/theme.mjs';

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

test('launcher imports version 1 files and keeps a retired starter it was left on', async t => {
  const file = await launcherFile(t);
  const appearance = launcherAppearance(file);
  const [canopy, tide, ember] = retiredStarterThemes.map(item => item.theme);
  const preview = appearance.preview(JSON.stringify({...tide, name: 'Harbor'}));
  assert.equal(preview.name, 'Harbor');
  assert.deepEqual(preview.light, preview.dark);
  assert.equal(preview.light.variables['--bg'], tide.tokens.bg);

  // Saved by an earlier launcher: Ember chosen, no import.
  await writeFile(file, JSON.stringify({selected: 'ember'}));
  const kept = await appearance.get();
  assert.equal(kept.selected, 'custom');
  assert.equal(kept.themes.at(-1).name, 'Ember');
  assert.equal(kept.themes.at(-1).dark.scheme, 'dark');
  assert.equal(kept.themes.at(-1).light.variables['--bg'], ember.tokens.bg);
  await appearance.save({id: 'custom'});
  assert.deepEqual(JSON.parse(await readFile(file)).custom, validateTheme(ember));

  // A retired starter beside an imported theme gives way to the default; the import stays.
  await writeFile(file, JSON.stringify({selected: 'tide', custom: {...canopy, name: 'Reading room'}}));
  const fallback = await appearance.get();
  assert.equal(fallback.selected, 'cerulean');
  assert.equal(fallback.themes.at(-1).name, 'Reading room');
});
