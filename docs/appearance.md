---
title: "Create and share a theme"
---

Open **Appearance** in the dashboard. Choose a mode: **Match my device** follows your browser's light or dark setting as it changes, and **Light** or **Dark** keeps one. Then choose a theme. Cerulean pairs blues with bold rules and Instrument Sans. Cinder pairs warm oranges with crisp lines and Space Grotesk headings. Fern pairs greens with soft corners and Fraunces headings. Each has a light and a dark palette, and both meet a 4.5:1 contrast ratio for text and button labels. Customize one to start designing. Preview your changes in both palettes and save the theme to this workspace.

The workspace keeps its theme and mode, so every browser that opens it uses the same ones. With **Match my device**, each browser shows the palette for its own light or dark setting. The workspace owner can export a theme and someone else can import the same file. The Mac launcher also accepts a theme file before connecting. Its preference is local to the device, and it follows the Mac's light or dark appearance. Each connected dashboard follows its own server.

## Theme file

Save this as a UTF-8 JSON file of up to 16 KB. Every key is required, and no others are allowed.

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

- **style** sets the shape of the interface and adds no colors of its own. `crisp` uses hairline borders and small corners, `soft` uses larger corners and tints surfaces with the palette's accent, and `bold` uses heavy rules in the text color, square corners and stronger type. For now, the theme previews and the dashboard's component kit (notices, status labels and confirmations so far) show the style; the rest of the dashboard follows it as each screen is redesigned.
- **fonts** name the heading, body and monospace families. Instrument Sans, Space Grotesk, Fraunces and IBM Plex Mono come with the dashboard under the SIL Open Font License ([credits](https://github.com/your-space-ai/your-space/blob/main/web/public/fonts/CREDITS.txt)), so they look the same on every device. Any other name means a font installed on the device, or a generic choice such as system-ui, serif or monospace. Devices without that font use a system fallback.
- **light** and **dark** each hold ten colors with six hexadecimal digits after the hash: the background (`bg`), surfaces such as panels and cards (`panel`), text (`fg`), secondary text (`muted`), the accent, text on the accent (`accentInk`), borders, and the colors for errors (`danger`), success and warnings.

Fonts apply throughout the Your Space interface. Each installed app controls the content inside its pane. Theme files contain visual values only. They load no remote fonts, artwork, CSS or executable code.

## Version 1 files

Theme files from earlier releases have `"version": 1`, a `scheme` and nine colors with two fonts under `tokens`. They still import, in the dashboard and the Mac launcher. Their one palette applies in both modes, with the Crisp style and the generic monospace font. Version 1 has no warning color, so Your Space uses amber: `#a15c00` on a light palette and `#f2b24c` on a dark one, blended toward the text color until it reads at 4.5:1 on the background and surfaces. If no blend reaches 4.5:1, the warning color is the text color itself, which can read lower when the file's own colors are low in contrast, so check warnings after importing. Saving or exporting the theme writes version 2.

Earlier releases offered the Canopy, Tide and Ember starters. A workspace that used one, including by default, keeps it as its own theme, still selected.
