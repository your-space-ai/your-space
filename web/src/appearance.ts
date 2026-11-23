import { queryOptions, useQuery } from "@tanstack/react-query";
import { useLayoutEffect, useSyncExternalStore } from "react";
import {
  builtInThemes, modeScheme, paletteScheme, themeModes, themeVariables, validateTheme,
  type Theme, type ThemeLook, type ThemeMode,
} from "../../shared/appearance/theme.mjs";
import { api } from "./apps-api.ts";

export type ThemeEntry = { id: string; theme: Theme };
export type AppearanceCatalog = { revision: number; activeId: string; mode: ThemeMode; themes: ThemeEntry[] };
/** What the sign-in page receives: the active theme's look and the workspace's mode. */
export type WorkspaceLook = ThemeLook & { mode: ThemeMode };

export function workspaceLook(theme: Theme, mode: ThemeMode): WorkspaceLook {
  const { style, fonts, light, dark } = theme;
  return { mode, style, fonts, light, dark };
}

export const activePaletteQuery = queryOptions({
  queryKey: ["appearance", "palette"],
  queryFn: async () => {
    const look = await api<WorkspaceLook>("GET", "/api/appearance/active");
    const theme = validateTheme({ version: 2, name: "Workspace", style: look.style, fonts: look.fonts, light: look.light, dark: look.dark });
    if (!themeModes.includes(look.mode)) throw new Error("The workspace's appearance mode is not valid.");
    return workspaceLook(theme, look.mode);
  },
  retry: false,
});

export function catalogQuery(ownerId: string) {
  return queryOptions({
    queryKey: ["appearance", "library", ownerId],
    queryFn: () => api<AppearanceCatalog>("GET", "/api/appearance"),
    enabled: !!ownerId,
    retry: false,
  });
}

export function selectedTheme(catalog: AppearanceCatalog): Theme | undefined {
  return [...builtInThemes, ...catalog.themes].find((entry) => entry.id === catalog.activeId)?.theme;
}

const darkQuery = "(prefers-color-scheme: dark)";
function subscribe(onChange: () => void) {
  const media = window.matchMedia(darkQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** Whether the browser prefers a dark color scheme, updated live as the device changes. */
export function usePrefersDark() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(darkQuery).matches, () => false);
}

/** Apply the public look to the dashboard, its sign-in pages and native form controls. */
export function WorkspaceAppearance() {
  const { data } = useQuery(activePaletteQuery);
  const prefersDark = usePrefersDark();
  useLayoutEffect(() => {
    if (!data) return;
    const root = document.documentElement.style;
    const scheme = modeScheme(data.mode, prefersDark);
    const variables = themeVariables(data, scheme);
    for (const [property, value] of Object.entries(variables)) root.setProperty(property, value);
    // A version 1 theme has one palette for both modes, so native controls follow the palette itself.
    root.colorScheme = paletteScheme(data[scheme]);
    return () => {
      for (const property of Object.keys(variables)) root.removeProperty(property);
      root.removeProperty("color-scheme");
    };
  }, [data, prefersDark]);
  return null;
}
