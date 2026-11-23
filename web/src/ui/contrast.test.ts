// The kit's color pairs, worked out the way kit.css mixes them, meet WCAG AA in every built-in
// theme, light and dark: 4.5:1 for text and 3:1 for the edges and marks of controls. The gallery's
// browser check measures the same pairs as rendered.
import { describe, expect, it } from "vitest";
import {
  builtInThemes, contrastRatio, retiredStarterThemes, themeStyles, themeVariables, validateTheme, type Palette, type ThemeStyle,
} from "../../../shared/appearance/theme.mjs";

const channels = (hex: string) => [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));

/** color-mix(in srgb, first amount, second). */
function mix(first: string, amount: number, second: string) {
  const a = channels(first), b = channels(second);
  return "#" + a.map((value, index) => Math.round(value * amount + b[index]! * (1 - amount)).toString(16).padStart(2, "0")).join("");
}

const percent = (value: string | undefined) => Number.parseFloat(value ?? "") / 100;

function pairs(c: Palette, style: ThemeStyle) {
  const variables = themeVariables({ ...builtInThemes[0]!.theme, style }, "light");
  const surfaceTint = percent(variables["--surface-tint"]), controlTint = percent(variables["--control-tint"]), ruleInk = percent(variables["--rule-ink"]);
  const surface = mix(c.accent, surfaceTint, c.panel);
  const controlSurface = mix(c.accent, controlTint, c.panel);
  const controlLine = mix(c.fg, ruleInk, mix(c.fg, 0.5, c.border));
  const menuHover = mix(c.fg, 0.08, c.panel);
  const selectedRow = mix(c.accent, 0.1, c.panel);
  const tones = { neutral: c.muted, info: c.accent, success: c.success, warning: c.warning, danger: c.danger };
  const text: [string, string, string][] = [];
  const edges: [string, string, string][] = [];
  for (const [name, ground] of [["background", c.bg], ["panel", c.panel], ["tinted surface", surface]] as const) {
    text.push([`text on ${name}`, c.fg, ground], [`secondary text on ${name}`, c.muted, ground], [`quiet button on ${name}`, c.accent, ground],
      [`field error on ${name}`, c.danger, ground]);
    edges.push([`control edge on ${name}`, controlLine, ground], [`focus ring on ${name}`, c.accent, ground]);
    // A selected tab mixes the accent into whatever is behind it.
    text.push([`selected tab on ${name}`, c.fg, mix(c.accent, controlTint, ground)], [`tab on ${name}`, c.muted, ground]);
  }
  text.push(
    ["primary button", c.accentInk, c.accent], ["danger button", c.panel, c.danger], ["secondary button", c.fg, controlSurface],
    ["menu item on hover", c.fg, menuHover], ["danger menu item on hover", c.danger, menuHover],
    ["selected list item", c.fg, selectedRow], ["selected list item detail", c.muted, selectedRow],
    ["app monogram and count", c.accentInk, c.accent],
  );
  edges.push(["switch handle when off", c.muted, c.panel], ["switch handle when on", c.accentInk, c.accent], ["switch when on", c.accent, c.panel],
    ["empty state icon", c.accent, mix(c.accent, 0.12, c.panel)]);
  for (const [tone, color] of Object.entries(tones)) {
    const pill = mix(color, controlTint, c.panel), notice = mix(color, 0.07, c.panel);
    text.push([`${tone} pill label`, c.fg, pill], [`${tone} notice text`, c.fg, notice]);
    edges.push([`${tone} dot in a pill`, color, pill], [`${tone} dot on panel`, color, c.panel], [`${tone} dot on background`, color, c.bg], [`${tone} notice icon`, color, notice]);
  }
  return { text, edges };
}

function failures(list: [string, string, string][], minimum: number) {
  return list.map(([label, ink, ground]) => [label, Math.round(contrastRatio(ink, ground) * 100) / 100] as const).filter(([, ratio]) => ratio < minimum);
}

describe("component contrast", () => {
  for (const { theme } of builtInThemes) {
    for (const scheme of ["light", "dark"] as const) {
      it(`${theme.name} ${scheme} in its own style`, () => {
        const { text, edges } = pairs(theme[scheme], theme.style);
        expect(failures(text, 4.5)).toEqual([]);
        expect(failures(edges, 3)).toEqual([]);
      });
    }
  }

  // Workspaces that used Canopy, Tide or Ember keep them, converted from version 1 with the Crisp style.
  it("the retired starters, as workspaces keep them", () => {
    for (const { theme: original } of retiredStarterThemes) {
      const theme = validateTheme(original);
      const { text, edges } = pairs(theme.light, theme.style);
      expect([...failures(text, 4.5), ...failures(edges, 3)], theme.name).toEqual([]);
    }
  });

  // An owner can save a built-in palette with another style, so every style stays readable too.
  it("every built-in palette in every style", () => {
    for (const { theme } of builtInThemes) {
      for (const scheme of ["light", "dark"] as const) {
        for (const style of themeStyles) {
          const { text, edges } = pairs(theme[scheme], style);
          expect([...failures(text, 4.5), ...failures(edges, 3)], `${theme.name} ${scheme} ${style}`).toEqual([]);
        }
      }
    }
  });
});
