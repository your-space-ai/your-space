import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { fontSuggestions, themeVariables, validateTheme, type Theme } from "../../../shared/appearance/theme.mjs";

export type ThemeDraft = { id?: string; initial: Theme; revision: number };

const colors = [
  ["bg", "Background"], ["panel", "Surfaces"], ["fg", "Text"], ["muted", "Secondary text"],
  ["accent", "Accent"], ["accentInk", "Text on accent"], ["border", "Borders"],
  ["danger", "Errors"], ["success", "Success"],
] as const;

export function themeStyle(theme: Theme): CSSProperties {
  return { ...themeVariables(theme), colorScheme: theme.scheme } as CSSProperties;
}

function luminance(hex: string) {
  const linear = (offset: number) => {
    const channel = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(1) + 0.7152 * linear(3) + 0.0722 * linear(5);
}

function contrastIssues(theme: Theme) {
  const t = theme.tokens;
  return [
    ["text on the background", t.fg, t.bg],
    ["text on surfaces", t.fg, t.panel],
    ["secondary text on surfaces", t.muted, t.panel],
    ["accent button text", t.accentInk, t.accent],
  ].filter(([, ink, surface]) => {
    const a = luminance(ink!);
    const b = luminance(surface!);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) < 4.5;
  }).map(([label]) => label);
}

function Preview({ theme }: { theme: Theme }) {
  const issues = contrastIssues(theme);
  return (
    <aside className="editor-preview" aria-label="Theme preview">
      <h2>Live preview</h2>
      <div className="preview-sheet" style={themeStyle(theme)}>
        <div className="preview-title">Your workspace</div>
        <div className="preview-card">
          <strong>Apps</strong>
          <p>Your connected apps appear here.</p>
          <span className="sample-action">Open app</span>
        </div>
        <div className="preview-states"><span>Running</span><span>Error</span></div>
      </div>
      {issues.length > 0 ? <p className="contrast-advice" role="status">Low contrast for {issues.join(", ")}. Adjust these colors for easier reading.</p> : null}
    </aside>
  );
}

export function ThemeEditor({ draft, busy, stale, error, onCancel, onReload, onSave }: {
  draft: ThemeDraft;
  busy: boolean;
  stale: boolean;
  error: string;
  onCancel: () => void;
  onReload: () => void;
  onSave: (theme: Theme, activate: boolean, asCopy: boolean) => Promise<void>;
}) {
  const [theme, setTheme] = useState(draft.initial);
  const [activate, setActivate] = useState(false);
  const [preview, setPreview] = useState(draft.initial);
  const heading = useRef<HTMLHeadingElement>(null);
  // Focus the heading in the same commit that shows the editor. A passive effect can run a task
  // later, after the form takes input, and would pull focus away from a field being typed in.
  useLayoutEffect(() => { heading.current?.focus(); }, []);
  const parsed = useMemo(() => {
    try { return { value: validateTheme(theme) }; }
    catch (error) { return { message: error instanceof Error ? error.message : "Check the theme settings." }; }
  }, [theme]);
  useEffect(() => { if (parsed.value) setPreview(parsed.value); }, [parsed]);

  function token(key: keyof Theme["tokens"], value: string) {
    setTheme((current) => ({ ...current, tokens: { ...current.tokens, [key]: value } }));
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (parsed.value && !stale) void onSave(parsed.value, activate, false);
  };

  return (
    <main className="page appearance-page">
      <button type="button" className="text-button back-link" disabled={busy} onClick={onCancel}>‹ Appearance</button>
      <h1 ref={heading} tabIndex={-1}>{draft.id ? "Edit theme" : "Create a theme"}</h1>
      {error ? <p className="notice error" role="alert">{error}</p> : null}
      <div className="editor-grid">
        <form onSubmit={submit}>
          <fieldset className="editor-fields" disabled={busy}>
            <legend className="visually-hidden">Theme settings</legend>
            <div className="editor-basics">
              <label>Theme name<input required maxLength={60} value={theme.name} onChange={(e) => setTheme({ ...theme, name: e.target.value })} /></label>
              <label>Color scheme<select value={theme.scheme} onChange={(e) => setTheme({ ...theme, scheme: e.target.value as Theme["scheme"] })}><option value="light">Light</option><option value="dark">Dark</option></select></label>
            </div>
            <fieldset className="editor-group">
              <legend>Colors</legend>
              <div className="color-grid">
                {colors.map(([key, label]) => (
                  <div className="color-field" key={key}>
                    <label htmlFor={`hex-${key}`}>{label}</label>
                    <div>
                      <input type="color" aria-label={`Pick ${label.toLowerCase()} color`} value={/^#[0-9a-f]{6}$/i.test(theme.tokens[key]) ? theme.tokens[key] : preview.tokens[key]} onChange={(e) => token(key, e.target.value)} />
                      <input id={`hex-${key}`} spellCheck={false} autoComplete="off" value={theme.tokens[key]} maxLength={7} onChange={(e) => token(key, e.target.value)} />
                    </div>
                  </div>
                ))}
              </div>
            </fieldset>
            <fieldset className="editor-group">
              <legend>Typography</legend>
              <p className="muted">Use a font installed on your device or choose a suggested family.</p>
              <div className="font-grid">
                <label>Heading font<input list="theme-fonts" value={theme.tokens.fontHeading} onChange={(e) => token("fontHeading", e.target.value)} /></label>
                <label>Body font<input list="theme-fonts" value={theme.tokens.fontBody} onChange={(e) => token("fontBody", e.target.value)} /></label>
              </div>
              <datalist id="theme-fonts">{fontSuggestions.map((font) => <option value={font} key={font} />)}</datalist>
            </fieldset>
            {parsed.message ? <p className="notice error" role="status">{parsed.message} The preview keeps the last valid settings.</p> : null}
            {stale ? (
              <div className="notice" role="status">Your theme library changed while you were editing.
                <div className="actions">
                  <button type="button" className="secondary" onClick={onReload}>Reload library</button>
                  <button type="button" className="secondary" disabled={!parsed.value} onClick={() => { if (parsed.value) void onSave(parsed.value, false, true); }}>Save as a new copy</button>
                </div>
              </div>
            ) : null}
            <label className="checkbox"><input type="checkbox" checked={activate} onChange={(e) => setActivate(e.target.checked)} /> Use this theme after saving</label>
            <div className="actions">
              <button type="submit" disabled={!parsed.value || stale}>{busy ? "Saving…" : "Save theme"}</button>
              <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
            </div>
          </fieldset>
        </form>
        <Preview theme={preview} />
      </div>
    </main>
  );
}
