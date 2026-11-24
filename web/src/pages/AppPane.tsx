import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Cell, Grid, Gridline, type GridImperativeHandle, type GridLayout } from "react-resizable-panels";
import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { appsQuery, errorMessage, STATE_LABEL, type AppSummary } from "../apps-api.ts";
import {
  createView,
  updateView,
  workspaceLayoutQuery,
  type PaneLayout,
  type SavedView,
  type ViewComposition,
} from "../workspace-layout.ts";
import {
  cellsFor,
  compositionSearch,
  defaultSizes,
  dividersFor,
  encodeSizes,
  gridShape,
  layoutFor,
  maxPanes,
  validSizes,
  type PaneSearch,
  type Sizes,
} from "../pane-layout.ts";
import "./app-pane.css";

export function AppPane({ name, search }: { name: string; search: PaneSearch }) {
  const apps = useQuery(appsQuery);
  const settings = useQuery(workspaceLayoutQuery);
  if (apps.isError || (search.view && settings.isError)) {
    return (
      <main className="page">
        <p role="alert">{errorMessage(apps.error ?? settings.error)}</p>
      </main>
    );
  }
  if (!apps.data || (search.view && !settings.data)) {
    return (
      <main className="page" aria-busy="true">
        <p className="muted">Loading apps…</p>
      </main>
    );
  }
  const openable = apps.data.apps.filter((app) => app.hasInterface);
  const saved = search.view ? settings.data?.views.find((view) => view.id === search.view) : undefined;
  if (search.view && !saved) {
    return (
      <main className="page">
        <p>This saved view is no longer available.</p>
        <Link to="/apps">Back to Apps</Link>
      </main>
    );
  }
  const fromSaved = saved && search.with === undefined;
  const names = fromSaved ? saved.composition.apps : [...new Set([name, ...(search.with ? search.with.split(",") : [])])];
  const selected = names.flatMap((id) => {
    const app = openable.find((a) => a.name === id);
    return app ? [app] : [];
  });
  if (!selected.length || (!fromSaved && selected[0]?.name !== name)) {
    return (
      <main className="page">
        <p>The selected app is unavailable.</p>
        <Link to="/apps">Back to Apps</Link>
      </main>
    );
  }
  // A saved view opens as it was saved. Apps opened together are laid out by how many there are.
  const exact = fromSaved && names.length === selected.length;
  const layout = exact ? saved.composition.layout : layoutFor(selected.length);
  return (
    <PaneWorkspace
      apps={selected}
      installed={openable}
      saved={saved}
      layout={layout}
      requested={exact ? saved.composition.sizes : undefined}
      missing={names.length - selected.length}
    />
  );
}

function proportions(sizes: Sizes): GridLayout {
  const axis = (values: number[]) => Object.fromEntries(values.map((value, index) => [String(index), value]));
  return { columns: axis(sizes.columns), rows: axis(sizes.rows) };
}

function PaneWorkspace({
  apps,
  installed,
  saved,
  layout,
  requested,
  missing,
}: {
  apps: AppSummary[];
  installed: AppSummary[];
  saved?: SavedView;
  layout: PaneLayout;
  requested?: Sizes;
  missing: number;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [editName, setEditName] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [focused, setFocused] = useState("");
  const element = useRef<HTMLDivElement>(null);
  const grid = useRef<GridImperativeHandle>(null);
  const savingViewId = useRef<string | undefined>(undefined);
  // Divider sizes last while these apps stay open together in the same view; nothing remembers them in
  // the browser. Another saved view with the same apps opens at its own sizes.
  const scope = layout + "/" + apps.map((app) => app.name).join(",");
  const [resized, setResized] = useState<{ scope: string; view?: string; sizes: Sizes } | null>(null);
  const kept = resized?.scope === scope && resized.view === saved?.id ? resized.sizes : undefined;
  // Leaving a saved view drops its unsaved sizes, so going back opens it at its saved ones.
  useEffect(() => {
    setResized((previous) => (previous?.view !== undefined && previous.view !== saved?.id ? null : previous));
  }, [saved?.id]);
  const sizes = kept ?? requested ?? defaultSizes(layout, apps.length);
  const geometry = encodeSizes(sizes);
  const { columns, rows } = gridShape(layout, apps.length);
  const cells = cellsFor(layout, apps.length);
  const lines = dividersFor(cells, columns, rows);
  const frameName = apps.some((app) => app.name === focused) ? focused : apps[0]!.name;
  const [compact, setCompact] = useState(() => matchMedia("(max-width: 799px)").matches);

  useEffect(() => {
    const media = matchMedia("(max-width: 799px)");
    const update = () => setCompact(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  // Keep each iframe's element and browsing context when headers, companions or sizes change.
  // The library's grids resize in place. Feed the validated proportions when the apps or view change.
  useLayoutEffect(() => {
    if (!compact) grid.current?.setLayout(proportions(sizes));
  }, [scope, geometry, compact]);

  useEffect(() => {
    const release = () => element.current?.removeAttribute("data-resizing");
    window.addEventListener("pointerup", release, true);
    window.addEventListener("pointercancel", release, true);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("pointerup", release, true);
      window.removeEventListener("pointercancel", release, true);
      window.removeEventListener("blur", release);
    };
  }, []);

  function current(): ViewComposition {
    // Proportions survive a temporary small viewport and are exactly what a saved view keeps.
    return { layout, apps: apps.map((app) => app.name), sizes };
  }
  function visit(names: string[]) {
    setNotice("");
    setNavigating(true);
    void navigate({
      to: "/open/$name",
      params: { name: names[0]! },
      // A just-saved view can be in the URL before its route finishes loading.
      search: (previous) => compositionSearch(names, previous.view === savingViewId.current ? previous.view : saved?.id),
    }).finally(() => setNavigating(false));
  }
  function resize(value: GridLayout) {
    const read = (axis: Record<string, number>, length: number) => Array.from({ length }, (_, i) => axis[String(i)]!);
    const updated = { columns: read(value.columns, columns), rows: read(value.rows, rows) };
    if (!validSizes(updated, layout, apps.length) || geometry === encodeSizes(updated)) return;
    setResized({ scope, view: saved?.id, sizes: updated });
  }
  async function save(event?: FormEvent) {
    event?.preventDefault();
    setSaving(true);
    setNotice("");
    try {
      const composition = current();
      const view =
        editName !== null
          ? await createView(editName.trim(), composition)
          : await updateView(saved!.id, saved!.revision, { composition });
      await queryClient.invalidateQueries({ queryKey: workspaceLayoutQuery.queryKey });
      setEditName(null);
      savingViewId.current = view.id;
      // The sizes being saved, and any drag while the view opens, now belong to the saved view.
      setResized((previous) => (previous ? { ...previous, view: view.id } : previous));
      await navigate({ to: "/open/$name", params: { name: composition.apps[0]! }, search: { view: view.id } });
      setResized((previous) => (previous ? { ...previous, view: view.id } : previous));
      setNotice("View saved.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The view could not be saved.");
    } finally {
      savingViewId.current = undefined;
      setSaving(false);
    }
  }
  return (
    <main className="pane-workspace" data-state="app-pane">
      <div className="pane-tools">
        {apps.length < maxPanes && installed.some((app) => !apps.some((selected) => selected.name === app.name)) && (
          <label>
            Add app{" "}
            <select
              value=""
              aria-label="Add an app to this layout"
              disabled={navigating}
              onChange={(e) => {
                const name = e.target.value;
                if (name) visit([...current().apps, name]);
              }}
            >
              <option value="">Choose an app…</option>
              {installed
                .filter((app) => !apps.some((selected) => selected.name === app.name))
                .map((app) => (
                  <option key={app.name} value={app.name}>
                    {app.title}
                  </option>
                ))}
            </select>
          </label>
        )}
        {compact && apps.length > 1 && (
          <label>
            Show{" "}
            <select aria-label="Visible app" value={frameName} onChange={(e) => setFocused(e.target.value)}>
              {apps.map((app) => (
                <option key={app.name} value={app.name}>
                  {app.title}
                </option>
              ))}
            </select>
          </label>
        )}
        {saved && (
          <button type="button" disabled={saving} className="secondary" onClick={() => void save()}>
            Update view
          </button>
        )}
        <button
          type="button"
          className="secondary"
          onClick={() => {
            setEditName("");
            setNotice("");
          }}
        >
          Save {saved ? "as new view" : "view"}
        </button>
      </div>
      {editName !== null && (
        <form className="pane-save" onSubmit={save}>
          <label>
            View name <input autoFocus maxLength={80} value={editName} onChange={(e) => setEditName(e.target.value)} />
          </label>
          <button disabled={saving || !editName.trim()}>Save</button>
          <button type="button" className="secondary" onClick={() => setEditName(null)}>
            Cancel
          </button>
        </form>
      )}
      {notice && (
        <p className="pane-note" role="status">
          {notice}
        </p>
      )}
      {missing > 0 && (
        <p className="pane-note" role="status">
          Some apps in this layout are no longer available.
        </p>
      )}
      <div
        className="pane-stage"
        ref={element}
        onPointerDownCapture={(event) => {
          if (!compact && event.target instanceof Element && event.target.closest("[data-separator]"))
            element.current?.setAttribute("data-resizing", "");
        }}
      >
        <Grid
          gridRef={grid}
          columns={columns}
          rows={rows}
          disabled={compact}
          defaultLayout={proportions(sizes)}
          className="pane-grid"
          resizeTargetMinimumSize={{ fine: 9, coarse: 24 }}
          onLayoutChanged={(value, meta) => {
            if (!compact && meta.isUserInteraction) resize(meta.requestedLayout ?? value);
          }}
        >
          {apps.map((app, i) => (
            <Cell
              className={"app-cell" + (frameName === app.name ? " current-cell" : "")}
              key={app.name}
              {...cells[i]!}
            >
              <Pane
                app={app}
                onClose={apps.length < 2 ? undefined : () => visit(current().apps.filter((name) => name !== app.name))}
              />
            </Cell>
          ))}
          {lines.map((line) => (
            <Gridline
              key={line.type + ":" + (line.type === "row" ? line.row : line.column)}
              className="pane-divider"
              elementRef={(node) => {
                if (node)
                  node.setAttribute(
                    "aria-label",
                    line.type === "column"
                      ? "Resize columns " + line.column + " and " + (line.column + 1)
                      : "Resize rows " + line.row + " and " + (line.row + 1),
                  );
              }}
              {...line}
            />
          ))}
        </Grid>
      </div>
    </main>
  );
}

function Pane({ app, onClose }: { app: AppSummary; onClose?: () => void }) {
  // At its link, the app is outside the gate: its own sign-in and cookies decide, and its origin is the
  // link. Its Caddy lets only Your Space frame it while the pane shows it there.
  const link = app.publish?.link ?? null;
  const rel = link ? "noreferrer" : "noopener";
  const atLink = link !== null && app.publish!.inPane;
  // At its link, the pane frames the app only once its Caddy lets Your Space frame it, and at an
  // address that carries that Caddy's ID. A page the browser cached before, such as the app's refusal
  // to be framed while a change was applied, has another address, so it is never shown here.
  const src = !app.pane
    ? null
    : link === null
      ? `${app.origin}/`
      : atLink && app.framing
        ? `${link}/?ys-pane=${app.framing}`
        : null;
  return (
    <section className="pane" aria-label={app.title} data-pane={app.name}>
      <header className="pane-bar">
        <strong>{app.title}</strong>
        {app.state !== "running" ? <span className={`state state-${app.state}`}>{STATE_LABEL[app.state]}</span> : null}
        <span className="spacer" />
        <Link to="/apps/$name" params={{ name: app.name }}>
          Details
        </Link>
        <a href={app.origin} target="_blank" rel={rel} aria-label="Open in its own tab">
          <span className="pane-link-wide">Open in its own tab</span>
          <span className="pane-link-short">Open tab</span>
        </a>
        {onClose ? (
          <button type="button" className="secondary" onClick={onClose} aria-label={`Close ${app.title}`}>
            Close
          </button>
        ) : null}
      </header>
      {src ? (
        <iframe data-testid="app-pane" title={app.title} src={src} />
      ) : atLink ? (
        <div className="page" aria-busy="true">
          <p className="muted">{`${app.title} shows here as soon as its published port is ready to show it inside Your Space.`}</p>
        </div>
      ) : (
        <div className="page">
          <p>
            {!app.pane
              ? `${app.title} can't run inside Your Space, so it opens in its own tab.`
              : `${app.title}'s link is plain HTTP, which browsers don't show inside Your Space's HTTPS page, so it opens in its own tab.`}
          </p>
          <a className="button" href={app.origin} target="_blank" rel={rel}>
            Open in its own tab
          </a>
        </div>
      )}
    </section>
  );
}
