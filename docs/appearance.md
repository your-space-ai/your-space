---
title: "Create and share a theme"
---

Open **Appearance** in the dashboard. Choose a mode: **Match my device** follows your browser's light or dark setting as it changes, and **Light** or **Dark** keeps one. Then choose a theme. Cerulean pairs blues with bold rules and Instrument Sans. Cinder pairs warm oranges with crisp lines and Space Grotesk headings. Fern pairs greens with soft corners and Fraunces headings. Each has a light and a dark palette, and both meet a 4.5:1 contrast ratio for text and button labels. Customize one to start designing. Preview your changes in both palettes and save the theme to this workspace.

The workspace keeps its theme and mode, so every browser that opens it uses the same ones. With **Match my device**, each browser shows the palette for its own light or dark setting. The workspace owner can export a theme and someone else can import the same file. The Mac launcher also accepts a theme file before connecting. Its preference is local to the device, and it follows the Mac's light or dark appearance. Each connected dashboard follows its own server.

## Theme file

Save this as a UTF-8 JSON file of up to 16 KB. Every key is required, and no others are allowed. Only version 2 files import; a version 1 file, from before themes had light and dark palettes, is refused. A workspace built from source before version 2 starts on Cerulean when it upgrades, and its saved themes are removed. Before upgrading, note the colors of any theme you want to keep, since its version 1 export won't import, and recreate it as version 2. A build from before version 2 can't read version 2 themes, so before going back to one, choose a built-in theme, then export and delete your saved themes.

```json
{
  "version": 2,
  "name": "My reading room",
  "style": "soft",
  "fonts": {
    "heading": "Iowan Old Style",
    "body": "Instrument Sans",
    "mono": "IBM Plex Mono"
  },
  "light": {
    "bg": "#eff1e4",
    "panel": "#fafbf2",
    "fg": "#182f24",
    "muted": "#4a6150",
    "accent": "#235b3f",
    "accentInk": "#ffffff",
    "border": "#b4c4ad",
    "danger": "#923a27",
    "success": "#24583b",
    "warning": "#8a5300"
  },
  "dark": {
    "bg": "#141c17",
    "panel": "#1c2620",
    "fg": "#e8efe4",
    "muted": "#a9b8a9",
    "accent": "#8fc7a0",
    "accentInk": "#141c17",
    "border": "#34443a",
    "danger": "#ff9e8a",
    "success": "#8fc7a0",
    "warning": "#e9b45c"
  }
}
```

- **style** sets the shape of the interface and adds no colors of its own. `crisp` uses hairline borders and small corners, `soft` uses larger corners and tints surfaces with the palette's accent, and `bold` uses heavy rules and square corners. For now, only the theme previews on the Appearance page show the style; the rest of the dashboard doesn't use it yet.
- **fonts** name the heading, body and monospace families. The dashboard comes with the Latin characters of Instrument Sans, Space Grotesk, Fraunces and IBM Plex Mono under the SIL Open Font License ([credits](https://github.com/your-space-ai/your-space/blob/main/web/public/fonts/CREDITS.txt)), so Latin text in them looks the same on every device. Other characters, and the Mac launcher, use fonts installed on the device. Any other name means a font installed on the device, or a generic choice such as system-ui, serif or monospace. Devices without that font use a system fallback, a monospace one for the monospace family.
- **light** and **dark** each hold ten colors with six hexadecimal digits after the hash: the background (`bg`), surfaces such as panels and cards (`panel`), text (`fg`), secondary text (`muted`), the accent, text on the accent (`accentInk`), borders, and the colors for errors (`danger`), success and warnings.

Fonts apply throughout the Your Space interface. Each installed app controls the content inside its pane. Theme files contain visual values only. They load no remote fonts, artwork, CSS or executable code.
