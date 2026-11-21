import { queryOptions, useQuery } from "@tanstack/react-query";
import { useLayoutEffect } from "react";
import { starterThemes, themeVariables, validateTheme, type Theme } from "../../appearance/theme.mjs";
import { api } from "./apps-api.ts";

export type ThemeEntry = { id: string; theme: Theme };
export type AppearanceCatalog = { revision: number; activeId: string; themes: ThemeEntry[] };
type Palette = Pick<Theme, "scheme" | "tokens">;

export const activePaletteQuery = queryOptions({
  queryKey: ["appearance", "palette"],
  queryFn: async () => {
    const palette = await api<Palette>("GET", "/api/appearance/active");
    return validateTheme({ version: 1, name: "Workspace", scheme: palette.scheme, tokens: palette.tokens });
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
  return [...starterThemes, ...catalog.themes].find((entry) => entry.id === catalog.activeId)?.theme;
}

/** Apply the public palette to the dashboard, its sign-in pages and native form controls. */
export function WorkspaceAppearance() {
  const { data } = useQuery(activePaletteQuery);
  useLayoutEffect(() => {
    if (!data) return;
    const root = document.documentElement.style;
    const variables = themeVariables(data);
    for (const [property, value] of Object.entries(variables)) root.setProperty(property, value);
    root.colorScheme = data.scheme;
    return () => {
      for (const property of Object.keys(variables)) root.removeProperty(property);
      root.removeProperty("color-scheme");
    };
  }, [data]);
  return null;
}
