import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { launcherAppearance } from '../src/appearance.mjs';
import { starterThemes } from '../../appearance/theme.mjs';

test('launcher keeps a validated custom theme on this device across built-in choices', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'ys-appearance-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const file = join(dir, 'launcher-theme.json');
  const appearance = launcherAppearance(file);
  const original = await appearance.get();
  assert.equal(original.selected, 'canopy');
  assert.deepEqual(original.themes.map(t => t.id), ['canopy','tide','ember']);

  const theme = {...starterThemes[2].theme, name: 'My palette'};
  const text = JSON.stringify(theme);
  assert.equal(appearance.preview(text).name, theme.name);
  for (const invalid of ['{}', 'x'.repeat(20000), JSON.stringify({...theme, javascript:'ignored?'})]) {
    assert.ok(appearance.preview(invalid).error);
    assert.ok((await appearance.save({id:'custom', text:invalid})).error);
  }
  assert.ok((await appearance.save({id:'custom'})).error);
  assert.ok((await appearance.save({id:'elsewhere', text})).error);
  const saved = await appearance.save({id:'custom', text});
  assert.equal(saved.selected, 'custom');
  assert.equal(saved.themes.at(-1).variables['--bg'], theme.tokens.bg);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(file)).custom.name, theme.name);

  const other = await appearance.save({id:'tide'});
  assert.equal(other.selected, 'tide');
  const reopened = launcherAppearance(file);
  assert.equal((await reopened.get()).themes.at(-1).name, theme.name);
  assert.equal((await reopened.save({id:'custom'})).selected, 'custom');

  await writeFile(file, '{corrupt');
  assert.deepEqual(await reopened.get(), original);
});
