import assert from 'node:assert/strict';
import test from 'node:test';
import { launcherTheme } from '../src/appearance.mjs';
import { builtInThemes, defaultThemeId, themeVariables } from '../../shared/appearance/theme.mjs';

test('the launcher shows the default theme in both palettes and keeps none of its own', () => {
  const { theme } = builtInThemes.find(entry => entry.id === defaultThemeId);
  assert.deepEqual(launcherTheme(), {
    id: defaultThemeId, name: theme.name,
    light: { scheme: 'light', variables: themeVariables(theme, 'light') },
    dark: { scheme: 'dark', variables: themeVariables(theme, 'dark') },
  });
});
