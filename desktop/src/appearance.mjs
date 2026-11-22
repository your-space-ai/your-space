import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { defaultThemeId, starterThemes, themeVariables, validateTheme } from '../../shared/appearance/theme.mjs';

const limit = 16 * 1024;

function card(id, theme) {
  return { id, name: theme.name, scheme: theme.scheme, variables: themeVariables(theme) };
}

export function previewTheme(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > limit) throw new Error();
  return validateTheme(JSON.parse(text));
}

export function launcherAppearance(file) {
  const presets = starterThemes.map(({ id, theme }) => card(id, theme));
  const builtIn = id => presets.some(item => item.id === id);

  async function read() {
    try {
      const saved = JSON.parse(await readFile(file, 'utf8'));
      const custom = saved.custom ? validateTheme(saved.custom) : undefined;
      const selected = builtIn(saved.selected) || (saved.selected === 'custom' && custom) ? saved.selected : defaultThemeId;
      return { selected, custom };
    } catch {
      return { selected: defaultThemeId };
    }
  }

  function library({ selected, custom }) {
    return { selected, themes: custom ? [...presets, card('custom', custom)] : presets };
  }

  return {
    get: async () => library(await read()),
    preview: text => {
      try { return card('custom', previewTheme(text)); }
      catch { return { error: { message: 'Choose a valid Your Space theme JSON file, up to 16 KiB.' } }; }
    },
    save: async ({ id, text } = {}) => {
      const saved = await read();
      let custom = saved.custom;
      if (id === 'custom' && text !== undefined) {
        try { custom = previewTheme(text); }
        catch { return { error: { message: 'Choose a valid Your Space theme JSON file, up to 16 KiB.' } }; }
      } else if (text !== undefined) return { error: { message: 'Choose one of the available themes.' } };
      if (!builtIn(id) && !(id === 'custom' && custom)) return { error: { message: 'Choose one of the available themes.' } };
      const choice = { selected: id, custom };
      const temporary = file + '.' + randomUUID();
      try {
        await mkdir(dirname(file), { recursive: true, mode: 0o700 });
        await writeFile(temporary, JSON.stringify(choice), { flag: 'wx', mode: 0o600 });
        await rename(temporary, file);
      } catch {
        return { error: { message: 'Couldn’t save the launcher theme on this Mac. Try again.' } };
      } finally {
        await rm(temporary, { force: true }).catch(() => {});
      }
      return library(choice);
    },
  };
}
