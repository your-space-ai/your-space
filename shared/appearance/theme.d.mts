export type ThemeStyle = 'crisp' | 'soft' | 'bold';
export type ThemeMode = 'system' | 'light' | 'dark';
export type ColorScheme = 'light' | 'dark';
export interface Palette {
  bg: string; panel: string; fg: string; muted: string; accent: string; accentInk: string;
  border: string; danger: string; success: string; warning: string;
}
export interface ThemeFonts { heading: string; body: string; mono: string }
export interface Theme {
  version: 2;
  name: string;
  style: ThemeStyle;
  fonts: ThemeFonts;
  light: Palette;
  dark: Palette;
}
/** A theme's presentation values without its name: what the sign-in page receives. */
export type ThemeLook = Pick<Theme, 'style' | 'fonts' | 'light' | 'dark'>;
export const colorKeys: readonly (keyof Palette)[];
export const themeStyles: readonly ThemeStyle[];
export const themeModes: readonly ThemeMode[];
export const defaultThemeId: string;
export const builtInThemes: {id: string; theme: Theme}[];
export const bundledFonts: string[];
export const fontSuggestions: string[];
export function validateTheme(value: unknown): Theme;
export function themeVariables(look: ThemeLook, scheme: ColorScheme): Record<string, string>;
export function contrastRatio(first: string, second: string): number;
export function paletteScheme(colors: Palette): ColorScheme;
export function surfaceColor(colors: Palette, style: ThemeStyle): string;
export function modeScheme(mode: ThemeMode, prefersDark: boolean): ColorScheme;
