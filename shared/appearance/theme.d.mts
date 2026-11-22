export interface ThemeTokens {
  bg: string; panel: string; fg: string; muted: string; accent: string; accentInk: string;
  border: string; danger: string; success: string; fontBody: string; fontHeading: string;
}
export interface Theme {
  version: 1;
  name: string;
  scheme: 'light' | 'dark';
  tokens: ThemeTokens;
}
export const defaultThemeId: string;
export const starterThemes: {id: string; theme: Theme}[];
export const fontSuggestions: string[];
export function validateTheme(value: unknown): Theme;
export function themeVariables(appearance: Pick<Theme, 'scheme' | 'tokens'>): Record<string, string>;
