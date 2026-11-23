import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent } from "react";
import {
  contrastRatio, fontSuggestions, paletteScheme, themeStyles, themeVariables, validateTheme,
  type ColorScheme, type Palette, type Theme, type ThemeFonts, type ThemeLook, type ThemeStyle,
} from "../../../shared/appearance/theme.mjs";

export type ThemeDraft = { id?: string; initial: Theme; revision: number };

const colors = [
  ["bg", "Background"], ["panel", "Surfaces"], ["fg", "Text"], ["muted", "Secondary text"],
  ["accent", "Accent"], ["accentInk", "Text on accent"], ["border", "Borders"],
  ["danger", "Errors"], ["success", "Success"], ["warning", "Warnings"],
] as const;
export const schemes = [["light", "Light"], ["dark", "Dark"]] as const;
export const styleNames: Record<ThemeStyle, string> = { crisp: "Crisp", soft: "Soft", bold: "Bold" };
const styleHints: Record<ThemeStyle, string> = {
  crisp: "hairline borders and small corners",
  soft: "tinted surfaces and larger corners",
  bold: "heavy rules and square corners",
};
const fonts = [["heading", "Heading font"], ["body", "Body font"], ["mono", "Monospace font"]] as const;

export function themeStyle(theme: ThemeLook, scheme: ColorScheme): CSSProperties {
  return { ...themeVariables(theme, scheme), colorScheme: paletteScheme(theme[scheme]) } as CSSProperties;
}

function contrastIssues(palette: Palette) {
  return [
    ["text on the background", palette.fg, palette.bg],
    ["text on surfaces", palette.fg, palette.panel],
    ["secondary text on surfaces", palette.muted, palette.panel],
    ["accent button text", palette.accentInk, palette.accent],
  ].filter(([, ink, surface]) => contrastRatio(ink!, surface!) < 4.5).map(([label]) => label);
}

/** A small sample of the dashboard in one of a theme's palettes. */
export function ThemeSample({ theme, scheme, label }: { theme: ThemeLook; scheme: ColorScheme; label: string }) {
  return (
    <figure className="theme-sample">
      <figcaption>{label}</figcaption>
      <div className="preview-sheet" style={themeStyle(theme, scheme)} aria-hidden="true">
        <div className="preview-title">Your workspace</div>
        <div className="preview-card">
          <strong>Apps</strong>
          <p>Your connected apps appear here.</p>
          <span className="sample-action">Open app</span>
        </div>
        <div className="preview-states"><span className="state-success">Running</span><span className="state-warning">Needs you</span><span className="state-danger">Error</span></div>
      </div>
    </figure>
  );
}

function Preview({ theme }: { theme: Theme }) {
  return (
    <aside className="editor-preview" aria-label="Theme preview">
      <h2>Live preview</h2>
      {schemes.map(([scheme, label]) => {
        const issues = contrastIssues(theme[scheme]);
        return (
          <div key={scheme}>
            <ThemeSample theme={theme} scheme={scheme} label={label} />
            {issues.length > 0 ? <p className="contrast-advice" role="status">Low contrast in {label} for {issues.join(", ")}. Adjust these colors for easier reading.</p> : null}
          </div>
        );
      })}
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

  function color(scheme: ColorScheme, key: keyof Palette, value: string) {
    setTheme((current) => ({ ...current, [scheme]: { ...current[scheme], [key]: value } }));
  }
  function font(key: keyof ThemeFonts, value: string) {
    setTheme((current) => ({ ...current, fonts: { ...current.fonts, [key]: value } }));
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
              <label>Style<select value={theme.style} onChange={(e) => setTheme({ ...theme, style: e.target.value as ThemeStyle })}>
                {themeStyles.map((style) => <option value={style} key={style}>{styleNames[style]}: {styleHints[style]}</option>)}
              </select></label>
            </div>
            {schemes.map(([scheme, label]) => (
              <fieldset className="editor-group" key={scheme}>
                <legend>{label} colors</legend>
                <div className="color-grid">
                  {colors.map(([key, name]) => (
                    <div className="color-field" key={key}>
                      <label htmlFor={`${scheme}-${key}`}><span className="visually-hidden">{label} </span>{name}</label>
                      <div>
                        <input type="color" aria-label={`Pick the ${label.toLowerCase()} ${name.toLowerCase()} color`}
                          value={/^#[0-9a-f]{6}$/i.test(theme[scheme][key]) ? theme[scheme][key] : preview[scheme][key]} onChange={(e) => color(scheme, key, e.target.value)} />
                        <input id={`${scheme}-${key}`} spellCheck={false} autoComplete="off" value={theme[scheme][key]} maxLength={7} onChange={(e) => color(scheme, key, e.target.value)} />
                      </div>
                    </div>
                  ))}
                </div>
              </fieldset>
            ))}
            <fieldset className="editor-group">
              <legend>Typography</legend>
              <p className="muted">Instrument Sans, Space Grotesk, Fraunces and IBM Plex Mono come with Your Space. Other fonts need to be installed on each device.</p>
              <div className="font-grid">
                {fonts.map(([key, label]) => <label key={key}>{label}<input list="theme-fonts" value={theme.fonts[key]} onChange={(e) => font(key, e.target.value)} /></label>)}
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
