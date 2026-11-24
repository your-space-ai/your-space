import { builtInThemes, defaultThemeId, paletteScheme, themeVariables } from '../../shared/appearance/theme.mjs';

// The launcher shows Your Space's default theme in the Mac's light or dark appearance, so it carries
// both palettes. It keeps no theme of its own: each workspace keeps its theme on its server
// (decision 2026-11-23, Alpha scope).
export function launcherTheme() {
  const { id, theme } = builtInThemes.find(entry => entry.id === defaultThemeId);
  const look = scheme => ({ scheme: paletteScheme(theme[scheme]), variables: themeVariables(theme, scheme) });
  return { id, name: theme.name, light: look('light'), dark: look('dark') };
}
