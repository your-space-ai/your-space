# Create and share a theme

Open **Appearance** in the dashboard. Choose Canopy for forest greens and serif headings, Tide for cool blues and sans-serif type, or Ember for charcoal, copper and monospaced headings. Make a copy to start designing. Preview your changes and save the theme to this workspace.

The workspace owner can export a theme and someone else can import the same file. The Mac launcher also accepts a theme file before connecting. Its preference is local to the device. Each connected dashboard follows its own server.

## Theme file

Save this as a UTF-8 JSON file. The nine colors use six hexadecimal digits after the hash. The two fonts can name a locally installed family or a generic choice such as system-ui, serif or monospace. Devices without your font use a system fallback. The scheme sets native control colors.

```json
{
  "version": 1,
  "name": "My reading room",
  "scheme": "light",
  "tokens": {
    "bg": "#eff1e4",
    "panel": "#fafbf2",
    "fg": "#182f24",
    "muted": "#4a6150",
    "accent": "#235b3f",
    "accentInk": "#ffffff",
    "border": "#b4c4ad",
    "danger": "#923a27",
    "success": "#24583b",
    "fontBody": "system-ui",
    "fontHeading": "Iowan Old Style"
  }
}
```

Body and heading fonts apply throughout the Your Space interface. Each installed app controls the content inside its pane. Theme files contain visual values only. They load no remote fonts, artwork, CSS or executable code.

The three bundled landscape illustrations are original generated artwork for this repository and ship as local WebP files under the project license. Exported files carry only the colors and fonts.
