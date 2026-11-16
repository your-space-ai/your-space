// An app in a pane (journey 002, US4, US10, FR-016): the app on its own origin inside Your Space's
// layout, or two apps side by side on a wide screen. An app that can't run in a pane opens in its
// own tab, behind the same access check.
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { appsQuery, errorMessage, STATE_LABEL, type AppSummary } from "../apps-api.ts";

export function AppPane({ name, beside }: { name: string; beside?: string }) {
  const apps = useQuery(appsQuery);
  const navigate = useNavigate();
  if (apps.isError) {
    return (
      <main className="page">
        <p className="notice error" role="alert">
          {errorMessage(apps.error)}
        </p>
      </main>
    );
  }
  if (!apps.data) {
    return (
      <main className="page" aria-busy="true">
        <p className="muted">Loading…</p>
      </main>
    );
  }
  const openable = apps.data.apps.filter((a) => a.hasInterface);
  const first = openable.find((a) => a.name === name);
  if (!first) {
    return (
      <main className="page">
        <p>There is no app called {name} to open.</p>
        <Link to="/apps">Back to Apps</Link>
      </main>
    );
  }
  const second = beside && beside !== name ? openable.find((a) => a.name === beside) : undefined;
  const others = openable.filter((a) => a.name !== name);

  return (
    <main className={second ? "panes two" : "panes"} data-state="app-pane">
      <Pane app={first} />
      {second ? <Pane app={second} onClose={() => void navigate({ to: "/open/$name", params: { name }, search: {} })} /> : null}
      {!second && others.length > 0 ? (
        <div className="beside">
          <label>
            Open beside it
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) void navigate({ to: "/open/$name", params: { name }, search: { with: e.target.value } });
              }}
            >
              <option value="">Choose an app…</option>
              {others.map((a) => (
                <option key={a.name} value={a.name}>
                  {a.title}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
    </main>
  );
}

function Pane({ app, onClose }: { app: AppSummary; onClose?: () => void }) {
  return (
    <section className="pane" aria-label={app.title} data-pane={app.name}>
      <header className="pane-bar">
        <strong>{app.title}</strong>
        {app.state !== "running" ? <span className={`state state-${app.state}`}>{STATE_LABEL[app.state]}</span> : null}
        <span className="spacer" />
        <Link to="/apps/$name" params={{ name: app.name }}>
          Details
        </Link>
        <a href={app.origin} target="_blank" rel="noopener">
          Open in its own tab
        </a>
        {onClose ? (
          <button type="button" className="secondary" onClick={onClose} aria-label={`Close ${app.title}`}>
            Close
          </button>
        ) : null}
      </header>
      {app.pane ? (
        <iframe data-testid="app-pane" title={app.title} src={`${app.origin}/`} />
      ) : (
        <div className="page">
          <p>{app.title} can't run inside Your Space, so it opens in its own tab.</p>
          <a className="button" href={app.origin} target="_blank" rel="noopener">
            Open in its own tab
          </a>
        </div>
      )}
    </section>
  );
}
