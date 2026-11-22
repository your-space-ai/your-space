// Version 1 portable themes contain only presentation values. All clients use
// this same parser before applying a theme or accepting an imported file.
const palettes = [
  ['canopy', 'Canopy', 'light', ['#eff1e4', '#fafbf2', '#182f24', '#4a6150', '#235b3f', '#ffffff', '#b4c4ad', '#923a27', '#24583b'], 'system-ui', 'Georgia'],
  ['tide', 'Tide', 'light', ['#eaf2f8', '#fcfeff', '#122c41', '#466071', '#17567d', '#ffffff', '#abc3d2', '#963e42', '#1b645f'], 'Avenir Next', 'Avenir Next'],
  ['ember', 'Ember', 'dark', ['#21191b', '#302123', '#ffeddb', '#d4b5a8', '#ffad74', '#301c19', '#78564a', '#ff9e97', '#a7d1a0'], 'system-ui', 'ui-monospace'],
];
const colorKeys = ['bg', 'panel', 'fg', 'muted', 'accent', 'accentInk', 'border', 'danger', 'success'];
const keys = [...colorKeys, 'fontBody', 'fontHeading'];
export const defaultThemeId = 'canopy';
export const fontSuggestions = ['system-ui', 'serif', 'monospace', 'Georgia', 'Avenir Next', 'Verdana', 'Trebuchet MS', 'Iowan Old Style', 'Menlo'];
export const starterThemes = palettes.map(([id, name, scheme, colors, fontBody, fontHeading]) => ({
  id, theme: {version: 1, name, scheme, tokens: {
    ...Object.fromEntries(colorKeys.map((key, index) => [key, colors[index]])), fontBody, fontHeading,
  }},
}));

function hasKeys(value, fields) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));
}

const fontPattern = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} _'-]{0,63}$/u;
export function validateTheme(value) {
  if (!hasKeys(value, ['version', 'name', 'scheme', 'tokens']) || value.version !== 1) {
    throw new Error('Choose a version 1 Your Space theme file.');
  }
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 60 || /[\p{C}]/u.test(value.name)) {
    throw new Error('Give your theme a name of 1–60 characters.');
  }
  if (!['light', 'dark'].includes(value.scheme)) throw new Error('Choose a light or dark theme.');
  if (!hasKeys(value.tokens, keys)) throw new Error('The theme needs nine colors and two font families.');
  const tokens = {};
  for (const key of colorKeys) {
    const color = value.tokens[key];
    if (typeof color !== 'string' || !/^#[a-f0-9]{6}$/i.test(color)) throw new Error('Use a six-digit hex value for each color.');
    tokens[key] = color.toLowerCase();
  }
  for (const key of ['fontBody', 'fontHeading']) {
    const name = value.tokens[key];
    if (typeof name !== 'string' || !fontPattern.test(name) || name !== name.trim()) {
      throw new Error('Use one installed font family name of up to 64 characters.');
    }
    tokens[key] = name;
  }
  return {version: 1, name: value.name.trim(), scheme: value.scheme, tokens};
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
  const fallback = ['Georgia','Iowan Old Style','Baskerville','Times New Roman'].includes(name) ? stacks.serif :
    ['Menlo','Consolas','Courier New'].includes(name) ? stacks.monospace : stacks['system-ui'];
  return '"' + name + '", ' + fallback;
}

export function themeVariables(appearance) {
  const {tokens} = validateTheme({version:1, name:'Workspace', scheme:appearance?.scheme, tokens:appearance?.tokens});
  return {
    '--bg': tokens.bg, '--panel': tokens.panel, '--fg': tokens.fg, '--muted': tokens.muted,
    '--accent': tokens.accent, '--accent-ink': tokens.accentInk, '--border': tokens.border,
    '--danger': tokens.danger, '--success': tokens.success, '--font-body': fontStack(tokens.fontBody),
    '--font-heading': fontStack(tokens.fontHeading),
  };
}
