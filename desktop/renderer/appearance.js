// Paints Your Space's default theme, which the main process reads from the shared theme module, in
// the palette for the Mac's light or dark appearance.
(() => {
  const dark = window.matchMedia("(prefers-color-scheme: dark)");
  api.appearance().then(theme => {
    function paint() {
      const look = dark.matches ? theme.dark : theme.light;
      for (const [key, value] of Object.entries(look.variables)) document.documentElement.style.setProperty(key, value);
      document.documentElement.style.colorScheme = look.scheme;
    }
    paint();
    dark.addEventListener("change", paint);
  }).catch(() => {});
})();
