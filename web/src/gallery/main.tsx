// The component gallery: every kit component in one built-in theme and palette, chosen with
// ?theme=cerulean|cinder|fern&scheme=light|dark. It loads the dashboard's own stylesheets, so it shows
// the components as they render in the app.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { builtInThemes, paletteScheme, themeVariables } from "../../../shared/appearance/theme.mjs";
import "../fonts.css";
import "../styles.css";
import "../appearance.css";
import "../creator.css";
import "../ui/kit.css";
import "./gallery.css";
import { ToastProvider } from "../ui/index.ts";
import { Gallery } from "./Gallery.tsx";

const search = new URLSearchParams(location.search);
const entry = builtInThemes.find((item) => item.id === search.get("theme")) ?? builtInThemes[0]!;
const scheme = search.get("scheme") === "dark" ? "dark" : "light";
const root = document.documentElement;
for (const [property, value] of Object.entries(themeVariables(entry.theme, scheme))) root.style.setProperty(property, value);
root.style.colorScheme = paletteScheme(entry.theme[scheme]);
document.title = `${entry.theme.name} ${scheme} · Component kit`;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ToastProvider>
      <Gallery themeId={entry.id} scheme={scheme} />
    </ToastProvider>
  </StrictMode>,
);
