#!/usr/bin/env node
'use strict';

// The unscoped `your-space-ai` package only holds the name. Its command runs nothing: it points to
// the your-space-ai organization, where the CLI is published as @your-space-ai/cli, and exits with
// an error so a script that called it doesn't carry on as if the command had run.
process.stderr.write(
  [
    'Your Space is published by the your-space-ai organization on npm:',
    '  https://www.npmjs.com/org/your-space-ai',
    '',
    'Install with npx @your-space-ai/cli@<version>',
    'See https://docs.getyourspace.ai/install',
    '',
    'Installed this package globally? Remove it: npm uninstall -g your-space-ai',
    '',
  ].join('\n')
);
process.exitCode = 1;
