import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('./bin.js', import.meta.url));

test('your-space points to @your-space-ai/cli, runs nothing and exits 1', (t) => {
  // npm and npx stand-ins first on the PATH record any call, so the test sees if the command
  // starts installing or running anything.
  const shims = mkdtempSync(join(tmpdir(), 'your-space-shims-'));
  t.after(() => rmSync(shims, { recursive: true, force: true }));
  const called = join(shims, 'called');
  for (const name of ['npm', 'npx']) {
    writeFileSync(join(shims, name), `#!/bin/sh\necho "${name} $*" >> '${called}'\n`);
    chmodSync(join(shims, name), 0o755);
  }

  for (const args of [[], ['init', '--yes'], ['--version']]) {
    const result = spawnSync(process.execPath, [bin, ...args], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${shims}${delimiter}${process.env.PATH}` },
    });
    assert.equal(result.status, 1, `exit status for ${JSON.stringify(args)}`);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /https:\/\/www\.npmjs\.com\/org\/your-space-ai\n/);
    assert.match(result.stderr, /Install with npx @your-space-ai\/cli@<version>\n/);
    assert.match(result.stderr, /https:\/\/docs\.getyourspace\.ai\/install\n/);
  }
  assert.equal(existsSync(called), false, 'npm or npx was called');
});
