import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState, type ChangeEvent } from "react";
import { builtInThemes, defaultThemeId, validateTheme, type Theme, type ThemeMode } from "../../../shared/appearance/theme.mjs";
import { activePaletteQuery, catalogQuery, selectedTheme, workspaceLook, type AppearanceCatalog, type ThemeEntry } from "../appearance.ts";
import { ApiError, api, errorMessage } from "../apps-api.ts";
import { schemes, styleNames, ThemeEditor, ThemeSample, themeStyle, type ThemeDraft } from "../components/ThemeEditor.tsx";
import { sessionQuery } from "../queries.ts";

const themePath = "/api/appearance/themes";
type Change = { method: "POST" | "PUT" | "DELETE"; path: string; body: object };
const modes: [ThemeMode, string][] = [["system", "Match my device"], ["light", "Light"], ["dark", "Dark"]];

function download(theme: Theme) {
  const file = new Blob([JSON.stringify(validateTheme(theme), null, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = (theme.name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "your-space") + ".theme.json";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function Swatches({ theme }: { theme: Theme }) {
  return <span className="swatches" aria-hidden="true">{schemes.map(([scheme]) => (["bg", "fg", "accent"] as const)
    .map((key) => <i key={scheme + key} style={{ backgroundColor: theme[scheme][key] }} />))}</span>;
}

export function Appearance() {
  const session = useQuery(sessionQuery);
  const owner = session.data?.user.id ?? "";
  const options = catalogQuery(owner);
  const catalog = useQuery(options);
  const client = useQueryClient();
  const [draft, setDraft] = useState<ThemeDraft | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; revision: number } | null>(null);
  const [notice, setNotice] = useState("");
  // The mode a click asked for, shown until the server answers.
  const [modeChoice, setModeChoice] = useState<ThemeMode | null>(null);
  // Which mode click is the latest, so an earlier one that finishes later leaves its choice shown.
  const modeRequest = useRef(0);
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const wasEditing = useRef(false);
  // Like the editor's, the focus moves in the same commit that shows the library.
  useLayoutEffect(() => {
    if (!draft && wasEditing.current) heading.current?.focus();
    wasEditing.current = !!draft;
  }, [draft]);
  const write = useMutation({
    mutationFn: ({ method, path, body }: Change) => api<AppearanceCatalog>(method, path, body),
  });
  const data = catalog.data;
  const busy = write.isPending;

  async function change(request: Change, success: string) {
    if (busy) return false;
    setError("");
    setNotice("");
    try {
      const updated = await write.mutateAsync(request);
      await Promise.all([
        client.cancelQueries({ queryKey: options.queryKey }),
        client.cancelQueries({ queryKey: activePaletteQuery.queryKey }),
      ]);
      client.setQueryData(options.queryKey, updated);
      const active = selectedTheme(updated);
      if (active) client.setQueryData(activePaletteQuery.queryKey, workspaceLook(active, updated.mode));
      setNotice(success);
      return true;
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        setError(cause.code === "theme_in_use" ? "Choose another theme before deleting the current one." : "Your theme library changed. Review the latest version and try again.");
        // Another browser changed the library: show its latest themes, and apply the look from that
        // same snapshot, as a successful change does, so the mode controls and the page agree.
        const latest = await catalog.refetch();
        await client.cancelQueries({ queryKey: activePaletteQuery.queryKey });
        const active = latest.isSuccess ? selectedTheme(latest.data) : undefined;
        // A change that succeeded during these waits has already applied its newer look: keep it.
        const superseded = latest.isSuccess && client.getQueryData(options.queryKey)?.revision !== latest.data.revision;
        if (!superseded) {
          if (latest.isSuccess && active) client.setQueryData(activePaletteQuery.queryKey, workspaceLook(active, latest.data.mode));
          else await client.invalidateQueries({ queryKey: activePaletteQuery.queryKey });
        }
        setDeleting(null);
      } else setError(errorMessage(cause));
      return false;
    }
  }

  function edit(initial: Theme, id?: string) {
    if (!data) return;
    setNotice("");
    setError("");
    setDeleting(null);
    setDraft({ id, initial, revision: data.revision });
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const selected = input.files?.[0];
    input.value = "";
    if (!selected) return;
    setNotice("");
    setError("");
    if (selected.size > 16 * 1024) { setError("Choose a theme JSON file smaller than 16 KB."); return; }
    try {
      let value: unknown;
      try { value = JSON.parse(await selected.text()); }
      catch { setError("This file could not be read as JSON."); return; }
      edit(validateTheme(value));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Choose a valid theme file."); }
  }

  if (!data) return (
    <main className="page appearance-page"><h1>Appearance</h1>
      {catalog.isError ? <div className="notice error" role="alert">{errorMessage(catalog.error)} <button type="button" className="secondary" onClick={() => void catalog.refetch()}>Try again</button></div> : <p role="status">Loading themes…</p>}
    </main>
  );

  const library = data;
  const current = selectedTheme(library) ?? builtInThemes.find((item) => item.id === defaultThemeId)!.theme;
  const applyTheme = (entry: ThemeEntry) => change({ method: "PUT", path: "/api/appearance/selection", body: { id: entry.id, revision: library.revision } }, `${entry.theme.name} is now your workspace theme.`);
  const applyMode = async (mode: ThemeMode, label: string) => {
    if (busy) return;
    const request = ++modeRequest.current;
    setModeChoice(mode);
    try { await change({ method: "PUT", path: "/api/appearance/mode", body: { mode, revision: library.revision } }, `Mode set to ${label}.`); }
    finally { if (modeRequest.current === request) setModeChoice(null); }
  };
  const duplicate = (theme: Theme) => edit({ ...theme, name: `${theme.name.slice(0, 55).trimEnd()} copy` });

  if (draft) return (
    <ThemeEditor draft={draft} busy={busy} error={error} stale={draft.revision !== library.revision}
      onCancel={() => { setDraft(null); setError(""); }}
      onReload={() => { setDraft(null); setError(""); }}
      onSave={async (theme, activate, asCopy) => {
        const id = asCopy ? undefined : draft.id;
        const saved = await change({ method: id ? "PUT" : "POST", path: id ? `${themePath}/${encodeURIComponent(id)}` : themePath,
          body: { revision: asCopy ? library.revision : draft.revision, theme, activate } }, `${theme.name} saved.`);
        if (saved) setDraft(null);
      }} />
  );
  return (
    <main className="page appearance-page">
      <header className="appearance-heading"><div><h1 tabIndex={-1} ref={heading}>Appearance</h1><p className="muted">Choose the colors and type for your workspace.</p></div>
        <div className="actions">
          <button type="button" className="secondary" onClick={() => file.current?.click()} disabled={busy}>Import theme</button>
          <input type="file" accept=".json,application/json" hidden ref={file} onChange={(event) => void importFile(event)} />
          <button type="button" onClick={() => edit({ ...current, name: "Untitled theme" })} disabled={busy}>Create theme</button>
        </div>
      </header>
      <div role="status" className="theme-feedback">{notice}</div>
      {error ? <p className="notice error" role="alert">{error}</p> : null}
      <fieldset className="mode-choice">
        <legend className="collection-title">Mode</legend>
        <div className="mode-options">{modes.map(([mode, label]) => (
          <label key={mode} className="checkbox"><input type="radio" name="appearance-mode" value={mode} checked={(modeChoice ?? library.mode) === mode}
            onChange={() => void applyMode(mode, label)} /> {label}</label>
        ))}</div>
      </fieldset>
      <section aria-labelledby="starters">
        <h2 id="starters" className="collection-title">Built-in themes</h2>
        <div className="starter-grid">{builtInThemes.map((entry) => {
          const active = entry.id === library.activeId;
          return <article key={entry.id} className="starter-card" data-selected={active} aria-label={entry.theme.name}>
            <div className="starter-meta"><h3>{entry.theme.name}</h3><span>{styleNames[entry.theme.style]} · {entry.theme.fonts.heading}</span></div>
            <div className="starter-previews">{schemes.map(([scheme, label]) => <ThemeSample key={scheme} theme={entry.theme} scheme={scheme} label={label} />)}</div>
            <div className="starter-actions">
              <button type="button" className="secondary apply-theme" disabled={busy || active} aria-label={active ? `${entry.theme.name} is current` : `Use ${entry.theme.name}`} onClick={() => void applyTheme(entry)}>{active ? "✓ Current" : "Use theme"}</button>
              <button type="button" className="text-button" disabled={busy} aria-label={`Customize ${entry.theme.name}`} onClick={() => duplicate(entry.theme)}>Customize</button>
              <button type="button" className="export-button" aria-label={`Export ${entry.theme.name} as JSON`} title="Export JSON" onClick={() => download(entry.theme)}><span aria-hidden="true">↓</span></button>
            </div>
          </article>;
        })}</div>
      </section>
      <section className="personal-themes" aria-labelledby="custom">
        <h2 id="custom" className="collection-title">Your themes</h2>
        {!library.themes.length ? <div className="theme-empty"><span className="empty-swatch" aria-hidden="true">Aa</span><div><strong>No custom themes yet</strong><p>Customize a built-in theme or import a theme file.</p></div></div> : (
          <ul className="custom-list">{library.themes.map((entry) => {
            const active = entry.id === library.activeId;
            return <li key={entry.id} aria-label={entry.theme.name}>
              <div className="custom-row">{schemes.map(([scheme]) => <span key={scheme} className="custom-tile" style={themeStyle(entry.theme, scheme)} aria-hidden="true">Aa</span>)}
                <div className="custom-name"><strong>{entry.theme.name}</strong><Swatches theme={entry.theme} /></div>
                <div className="actions">
                  <button type="button" className="secondary apply-theme" disabled={busy || active} onClick={() => void applyTheme(entry)} aria-label={active ? `${entry.theme.name} is current` : `Use ${entry.theme.name}`}>{active ? "✓ Current" : "Use theme"}</button>
                  <button type="button" className="secondary" disabled={busy} onClick={() => edit(entry.theme, entry.id)}>Edit</button>
                </div>
              </div>
              <details className="theme-options"><summary>More options</summary>
                <div className="actions"><button type="button" className="text-button" disabled={busy} onClick={() => duplicate(entry.theme)}>Make a copy</button>
                  <button type="button" className="text-button" onClick={() => download(entry.theme)}>Export JSON</button>
                  {active ? <small>Choose another theme to delete this one.</small> : <button type="button" className="text-button danger-outline" disabled={busy} onClick={() => setDeleting({ id: entry.id, revision: library.revision })}>Delete theme</button>}
                </div>
              </details>
              {deleting?.id === entry.id ? <div className="confirm" role="group" aria-label="Confirm deletion">
                <p>Delete <strong>{entry.theme.name}</strong> from your workspace?</p>
                <div className="actions"><button type="button" className="danger" disabled={busy} onClick={async () => {
                  if (await change({ method: "DELETE", path: `${themePath}/${encodeURIComponent(entry.id)}`, body: { revision: deleting.revision } }, `${entry.theme.name} deleted.`)) setDeleting(null);
                }}>Delete</button><button type="button" className="secondary" disabled={busy} onClick={() => setDeleting(null)}>Keep theme</button></div>
              </div> : null}
            </li>;
          })}</ul>
        )}
      </section>
    </main>
  );
}
