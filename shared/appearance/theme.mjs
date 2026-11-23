// Portable themes contain only presentation values. All clients use this same parser before
// applying a theme or accepting an imported file. Version 2 holds a component style, three fonts
// and a light and a dark palette. A version 1 file still parses: it converts to version 2.
export const colorKeys = ['bg', 'panel', 'fg', 'muted', 'accent', 'accentInk', 'border', 'danger', 'success', 'warning'];
export const themeStyles = ['crisp', 'soft', 'bold'];
export const themeModes = ['system', 'light', 'dark'];
const fontKeys = ['heading', 'body', 'mono'];
const version1ColorKeys = colorKeys.filter(key => key !== 'warning');
const fontPattern = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} _'-]{0,63}$/u;

// The dashboard bundles these families, so a theme that names one renders the same on every device.
export const bundledFonts = ['Instrument Sans', 'Space Grotesk', 'Fraunces', 'IBM Plex Mono'];
export const fontSuggestions = [...bundledFonts, 'system-ui', 'serif', 'monospace', 'Georgia', 'Avenir Next', 'Verdana', 'Trebuchet MS', 'Iowan Old Style', 'Menlo'];

// Colors in colorKeys order. Cerulean's light success and Fern's light warning are a shade darker
// than first drawn, so that they read at 4.5:1 on the background.
const builtIns = [
  ['cerulean', 'Cerulean', 'bold', ['Instrument Sans', 'Instrument Sans', 'IBM Plex Mono'],
    '#F4F8FA #FFFFFF #0A1218 #52606A #0A6FB0 #FFFFFF #D9E3E8 #B3261E #1D8248 #A15C00',
    '#0A1218 #111C22 #EAF2F6 #94A6B0 #55C1FF #0A1218 #22313A #FF8A80 #5BD38A #F2B24C'],
  ['cinder', 'Cinder', 'crisp', ['Space Grotesk', 'Instrument Sans', 'IBM Plex Mono'],
    '#FBF6F2 #FFFFFF #24140F #6B5048 #C2410C #FFFFFF #EADBD2 #B3261E #2E7D4F #A15C00',
    '#1C1210 #291A16 #FFEDE3 #C9A99B #FF8A4C #1C1210 #3E2A24 #FF8A80 #7BD39A #FBBF24'],
  ['fern', 'Fern', 'soft', ['Fraunces', 'Instrument Sans', 'IBM Plex Mono'],
    '#F3F1E8 #FBFAF4 #1F2A1E #5B6656 #3F6B3A #FFFFFF #DCDCC9 #A3361F #3F6B3A #996137',
    '#151A14 #1E251C #ECEFE3 #A3AE9B #9BC98F #151A14 #2E382B #FF8A80 #9BC98F #D49A6A'],
];
const palette = text => Object.fromEntries(text.split(' ').map((color, index) => [colorKeys[index], color]));
export const defaultThemeId = 'cerulean';
export const builtInThemes = builtIns.map(([id, name, style, [heading, body, mono], light, dark]) => ({
  id, theme: validateTheme({version: 2, name, style, fonts: {heading, body, mono}, light: palette(light), dark: palette(dark)}),
}));

// The version 1 starters that the built-in themes replaced. A workspace or launcher that used one
// keeps it as its own copy; the server's 0013 migration holds the same values.
export const retiredStarterThemes = [
  ['canopy', 'Canopy', 'light', ['#eff1e4', '#fafbf2', '#182f24', '#4a6150', '#235b3f', '#ffffff', '#b4c4ad', '#923a27', '#24583b'], 'system-ui', 'Georgia'],
  ['tide', 'Tide', 'light', ['#eaf2f8', '#fcfeff', '#122c41', '#466071', '#17567d', '#ffffff', '#abc3d2', '#963e42', '#1b645f'], 'Avenir Next', 'Avenir Next'],
  ['ember', 'Ember', 'dark', ['#21191b', '#302123', '#ffeddb', '#d4b5a8', '#ffad74', '#301c19', '#78564a', '#ff9e97', '#a7d1a0'], 'system-ui', 'ui-monospace'],
].map(([id, name, scheme, colors, fontBody, fontHeading]) => ({
  id, theme: {version: 1, name, scheme, tokens: {
    ...Object.fromEntries(version1ColorKeys.map((key, index) => [key, colors[index]])), fontBody, fontHeading,
  }},
}));

function hasKeys(value, fields) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));
}

function channels(hex) {
  return [1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16));
}

function luminance(hex) {
  const [r, g, b] = channels(hex).map(value => value / 255)
    .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The WCAG contrast ratio of two six-digit hex colors. */
export function contrastRatio(first, second) {
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Whether a palette is light or dark: dark when its background is darker than its text. */
export function paletteScheme(colors) {
  return luminance(colors.bg) < luminance(colors.fg) ? 'dark' : 'light';
}

function mix(from, to, amount) {
  const a = channels(from), b = channels(to);
  return '#' + a.map((value, index) => Math.round(value + (b[index] - value) * amount).toString(16).padStart(2, '0')).join('');
}

// A version 1 palette has no warning color. Use amber, darker on a light palette and lighter on a
// dark one, and blend it toward the text color until it reads at 4.5:1 on the background and panels.
function warningFor(colors) {
  const amber = paletteScheme(colors) === 'dark' ? '#f2b24c' : '#a15c00';
  for (let step = 0; step <= 10; step++) {
    const color = mix(amber, colors.fg, step / 10);
    if (Math.min(contrastRatio(color, colors.bg), contrastRatio(color, colors.panel)) >= 4.5) return color;
  }
  return colors.fg;
}

function fontName(name) {
  if (typeof name !== 'string' || !fontPattern.test(name) || name !== name.trim()) {
    throw new Error('Use one installed font family name of up to 64 characters.');
  }
  return name;
}

function themeName(name) {
  if (typeof name !== 'string' || !name.trim() || name.length > 60 || /[\p{C}]/u.test(name)) {
    throw new Error('Give your theme a name of 1–60 characters.');
  }
  return name.trim();
}

function colors(value, keys) {
  const result = {};
  for (const key of keys) {
    const color = value[key];
    if (typeof color !== 'string' || !/^#[a-f0-9]{6}$/i.test(color)) throw new Error('Use a six-digit hex value for each color.');
    result[key] = color.toLowerCase();
  }
  return result;
}

// Version 1: one palette and its scheme, nine colors and two fonts. Its palette applies in both
// modes, with a derived warning color, the Crisp style and the generic monospace font.
function fromVersion1(value) {
  if (!['light', 'dark'].includes(value.scheme)) throw new Error('Choose a light or dark theme.');
  const keys = [...version1ColorKeys, 'fontBody', 'fontHeading'];
  if (!hasKeys(value.tokens, keys)) throw new Error('The theme needs nine colors and two font families.');
  const name = themeName(value.name);
  const single = colors(value.tokens, version1ColorKeys);
  const fonts = {heading: fontName(value.tokens.fontHeading), body: fontName(value.tokens.fontBody), mono: 'monospace'};
  single.warning = warningFor(single);
  return {version: 2, name, style: 'crisp', fonts, light: single, dark: {...single}};
}

/** Parses a version 1 or 2 theme and returns it as version 2, or throws a message for the owner. */
export function validateTheme(value) {
  if (hasKeys(value, ['version', 'name', 'scheme', 'tokens']) && value.version === 1) return fromVersion1(value);
  if (!hasKeys(value, ['version', 'name', 'style', 'fonts', 'light', 'dark']) || value.version !== 2) {
    throw new Error('Choose a version 1 or 2 Your Space theme file.');
  }
  const name = themeName(value.name);
  if (!themeStyles.includes(value.style)) throw new Error('Choose the crisp, soft or bold style.');
  if (!hasKeys(value.fonts, fontKeys)) throw new Error('The theme needs a heading, body and monospace font.');
  const fonts = {heading: fontName(value.fonts.heading), body: fontName(value.fonts.body), mono: fontName(value.fonts.mono)};
  if (!hasKeys(value.light, colorKeys) || !hasKeys(value.dark, colorKeys)) {
    throw new Error('The theme needs ten colors in each of its light and dark palettes.');
  }
  return {version: 2, name, style: value.style, fonts, light: colors(value.light, colorKeys), dark: colors(value.dark, colorKeys)};
}

function fontStack(name) {
  const stacks = {
    'system-ui': 'system-ui, sans-serif',
    'sans-serif': 'system-ui, sans-serif',
    'serif': 'ui-serif, Georgia, serif',
    'ui-serif': 'ui-serif, Georgia, serif',
    'monospace': 'ui-monospace, Menlo, Consolas, monospace',
    'ui-monospace': 'ui-monospace, Menlo, Consolas, monospace',
  };
  if (Object.hasOwn(stacks, name)) return stacks[name];
  const fallback = ['Fraunces', 'Georgia', 'Iowan Old Style', 'Baskerville', 'Times New Roman'].includes(name) ? stacks.serif :
    ['IBM Plex Mono', 'Menlo', 'Consolas', 'Courier New'].includes(name) ? stacks.monospace : stacks['system-ui'];
  return '"' + name + '", ' + fallback;
}

// Component shape for each style. Crisp: hairline borders and small corners. Soft: tinted
// surfaces and larger corners. Bold: heavy rules and square corners. --surface-tint and
// --control-tint are how much accent to mix into surfaces and secondary controls.
const styleVariables = {
  crisp: {'--radius': '6px', '--radius-control': '4px', '--border-width': '1px', '--rule-width': '1px', '--surface-tint': '0%', '--control-tint': '0%'},
  soft: {'--radius': '16px', '--radius-control': '10px', '--border-width': '1px', '--rule-width': '1px', '--surface-tint': '6%', '--control-tint': '12%'},
  bold: {'--radius': '0px', '--radius-control': '0px', '--border-width': '2px', '--rule-width': '3px', '--surface-tint': '0%', '--control-tint': '0%'},
};

/** The color panels and cards render with in a style: Soft mixes the accent into the surface color. */
export function surfaceColor(colors, style) {
  return mix(colors.panel, colors.accent, Number.parseFloat(styleVariables[style]['--surface-tint']) / 100);
}

/** The CSS custom properties for a theme's palette in one scheme, its fonts and its style. */
export function themeVariables(look, scheme) {
  const theme = validateTheme({version: 2, name: 'Workspace', style: look?.style, fonts: look?.fonts, light: look?.light, dark: look?.dark});
  const colors = scheme === 'dark' ? theme.dark : theme.light;
  return {
    '--bg': colors.bg, '--panel': colors.panel, '--fg': colors.fg, '--muted': colors.muted,
    '--accent': colors.accent, '--accent-ink': colors.accentInk, '--border': colors.border,
    '--danger': colors.danger, '--success': colors.success, '--warning': colors.warning,
    '--font-body': fontStack(theme.fonts.body), '--font-heading': fontStack(theme.fonts.heading),
    '--font-mono': fontStack(theme.fonts.mono), '--theme-style': theme.style, ...styleVariables[theme.style],
  };
}

/** The palette a mode shows: Match my device ('system') follows the browser's preference. */
export function modeScheme(mode, prefersDark) {
  return mode === 'dark' || (mode === 'system' && prefersDark) ? 'dark' : 'light';
}
