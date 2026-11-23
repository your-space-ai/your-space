import assert from 'node:assert/strict';
import test from 'node:test';
import {
  builtInThemes, colorKeys, contrastRatio, defaultThemeId, fontSuggestions, modeScheme, paletteScheme,
  retiredStarterThemes, surfaceColor, themeVariables, validateTheme,
} from './theme.mjs';

const textColors = ['fg', 'muted', 'accent', 'danger', 'success', 'warning'];
function unreadable(colors) {
  const issues = [];
  for (const surface of ['bg', 'panel']) {
    for (const ink of textColors) {
      if (contrastRatio(colors[ink], colors[surface]) < 4.5) issues.push(ink + ' on ' + surface);
    }
  }
  if (contrastRatio(colors.accentInk, colors.accent) < 4.5) issues.push('accentInk on accent');
  return issues;
}

test('the built-in themes are Cerulean, Cinder and Fern, readable in light and dark', () => {
  assert.deepEqual(builtInThemes.map(row => row.id), ['cerulean', 'cinder', 'fern']);
  assert.equal(defaultThemeId, 'cerulean');
  assert.deepEqual(builtInThemes.map(row => row.theme.style), ['bold', 'crisp', 'soft']);
  assert.deepEqual(builtInThemes.map(row => row.theme.fonts.heading), ['Instrument Sans', 'Space Grotesk', 'Fraunces']);
  for (const {theme} of builtInThemes) {
    assert.deepEqual(validateTheme(JSON.parse(JSON.stringify(theme))), theme);
    assert.equal(theme.fonts.mono, 'IBM Plex Mono');
    for (const scheme of ['light', 'dark']) {
      assert.deepEqual(unreadable(theme[scheme]), [], theme.name + ' ' + scheme);
      assert.equal(paletteScheme(theme[scheme]), scheme);
      const variables = themeVariables(theme, scheme);
      assert.equal(variables['--bg'], theme[scheme].bg);
      assert.equal(variables['--warning'], theme[scheme].warning);
      assert.equal(variables['--accent-ink'], theme[scheme].accentInk);
      assert.equal(variables['--theme-style'], theme.style);
      for (const name of ['--panel', '--fg', '--muted', '--accent', '--border', '--danger', '--success',
        '--font-body', '--font-heading', '--font-mono', '--radius', '--radius-control', '--border-width', '--rule-width',
        '--surface-tint', '--control-tint', '--rule-ink', '--weight-strong']) {
        assert.ok(variables[name], theme.name + ' ' + name);
      }
    }
  }
  const cerulean = themeVariables(builtInThemes[0].theme, 'light');
  assert.equal(cerulean['--font-mono'], '"IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace');
  assert.equal(themeVariables(builtInThemes[2].theme, 'dark')['--font-heading'], '"Fraunces", ui-serif, Georgia, serif');
  assert.deepEqual([cerulean['--radius'], cerulean['--border-width'], cerulean['--rule-ink'], cerulean['--weight-strong']], ['0px', '2px', '100%', '700']);
  assert.deepEqual([themeVariables(builtInThemes[1].theme, 'light')['--rule-ink'], themeVariables(builtInThemes[2].theme, 'light')['--surface-tint']], ['0%', '6%']);
});

test('a version 1 file converts: one palette in both modes, a readable warning, Crisp and monospace', () => {
  for (const {id, theme: original} of retiredStarterThemes) {
    const theme = validateTheme(original);
    assert.equal(theme.version, 2);
    assert.equal(theme.name, original.name);
    assert.equal(theme.style, 'crisp');
    assert.deepEqual(theme.fonts, {heading: original.tokens.fontHeading, body: original.tokens.fontBody, mono: 'monospace'});
    assert.deepEqual(theme.light, theme.dark);
    for (const key of colorKeys.filter(key => key !== 'warning')) assert.equal(theme.light[key], original.tokens[key]);
    assert.deepEqual(unreadable(theme.light), [], id);
    assert.equal(paletteScheme(theme.light), original.scheme);
    assert.deepEqual(validateTheme(JSON.parse(JSON.stringify(theme))), theme);
  }
  // Amber blends toward the text color when it would be hard to read on the palette.
  const {theme: canopy} = retiredStarterThemes[0];
  const dim = validateTheme({...canopy, tokens: {...canopy.tokens, bg: '#c8c8c8', panel: '#d0d0d0', fg: '#000000'}});
  assert.notEqual(dim.light.warning, '#a15c00');
  assert.ok(contrastRatio(dim.light.warning, '#c8c8c8') >= 4.5);
});

test('import accepts installed Unicode families and rejects unknown fields, versions or CSS', () => {
  const {theme} = builtInThemes[1];
  for (const font of [...fontSuggestions, '黑体', "L'Archivo"]) {
    for (const key of ['heading', 'body', 'mono']) {
      assert.equal(validateTheme({...theme, fonts: {...theme.fonts, [key]: font}}).fonts[key], font);
    }
  }
  for (const font of ['url(https://example.test/font)', 'x; color: red', 'foo, serif', ' inherited ', 'a'.repeat(65)]) {
    assert.throws(() => themeVariables({...theme, fonts: {...theme.fonts, body: font}}, 'light'));
    assert.throws(() => validateTheme({...theme, fonts: {...theme.fonts, mono: font}}));
  }
  const version1 = retiredStarterThemes[2].theme;
  for (const input of [
    {...theme, version: 3}, {...theme, version: '2'}, {...theme, version: 0}, {...version1, version: 2}, {...theme, version: 1},
    {...theme, name: 'a\nb'}, {...theme, name: ' '}, {...theme, name: 'a'.repeat(61)}, {...theme, uri: 'https://example.test/'},
    {...theme, style: 'sharp'}, {...theme, scheme: 'dark'}, {...theme, fonts: {...theme.fonts, display: 'serif'}},
    {...theme, fonts: {heading: 'serif', body: 'serif'}}, {...theme, light: {...theme.light, accent: 'red'}},
    {...theme, dark: {...theme.dark, bg: '#fff'}}, {...theme, dark: {...theme.dark, url: 'https://example.test/logo'}},
    {...theme, light: {...theme.light, warning: undefined}}, {...theme, dark: undefined},
    {...version1, tokens: {...version1.tokens, warning: '#ffaa00'}}, {...version1, scheme: 'dim'}, {name: 'incomplete'}, null, [],
  ]) {
    assert.throws(() => validateTheme(input), JSON.stringify(input)?.slice(0, 80));
  }
  assert.throws(() => validateTheme({...theme, version: 3}), /version 1 or 2/);
});

test('a mode picks a palette, and Match my device follows the preference', () => {
  assert.equal(modeScheme('light', true), 'light');
  assert.equal(modeScheme('dark', false), 'dark');
  assert.equal(modeScheme('system', true), 'dark');
  assert.equal(modeScheme('system', false), 'light');
});

test('Soft tints surfaces with the accent, and the other styles leave them as the panel color', () => {
  const colors = {...builtInThemes[0].theme.light, panel: '#ffffff', muted: '#767676', accent: '#000000'};
  assert.equal(surfaceColor(colors, 'crisp'), '#ffffff');
  assert.equal(surfaceColor(colors, 'bold'), '#ffffff');
  assert.equal(surfaceColor(colors, 'soft'), '#f0f0f0');
  // Secondary text that passes on the panel can fall short on Soft's tinted surface.
  assert.ok(contrastRatio(colors.muted, colors.panel) >= 4.5);
  assert.ok(contrastRatio(colors.muted, surfaceColor(colors, 'soft')) < 4.5);
  for (const {theme} of builtInThemes) {
    for (const scheme of ['light', 'dark']) {
      const surface = surfaceColor(theme[scheme], theme.style);
      for (const ink of ['fg', 'muted']) assert.ok(contrastRatio(theme[scheme][ink], surface) >= 4.5, theme.name + ' ' + scheme + ' ' + ink);
    }
  }
});
