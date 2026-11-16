// One app's details (journey 002, US5, US6, US8): its state, settings, internet access, and
// advanced controls (services, limits, logs).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { api, appQuery, errorMessage, STATE_LABEL, type AppDetail as Detail } from "../apps-api.ts";
import { JobProgress } from "../components/JobProgress.tsx";

const MIB = 1024 * 1024;

export function AppDetail({ name }: { name: string }) {
  const app = useQuery(appQuery(name));
  const [job, setJob] = useState<{ id: string; title: string } | null>(null);

  if (app.isError) {
    return (
      <main className="page">
        <p className="notice error" role="alert">
          {errorMessage(app.error)}
        </p>
        <Link to="/apps">Back to Apps</Link>
      </main>
    );
  }
  if (!app.data) {
    return (
      <main className="page" aria-busy="true">
        <p className="muted">Loading…</p>
      </main>
    );
  }
  const d = app.data;
  const started = (title: string) => (result: { jobId: string }) => setJob({ id: result.jobId, title });

  return (
    <main className="page" data-state="app-detail" data-app={d.name} data-app-state={d.state}>
      <p>
        <Link to="/apps">Apps</Link>
      </p>
      <h1>{d.title}</h1>
      <Status detail={d} onStarted={started(`Starting ${d.title}`)} />
      {job ? <JobProgress key={job.id} jobId={job.id} title={job.title} /> : null}
      <Settings detail={d} onStarted={started("Applying settings")} />
      <Outbound detail={d} onStarted={started("Updating internet access")} />
      <Advanced detail={d} onStarted={started("Applying limits")} />
    </main>
  );
}

function Status({ detail: d, onStarted }: { detail: Detail; onStarted: (r: { jobId: string }) => void }) {
  const queryClient = useQueryClient();
  const start = useMutation({
    mutationFn: () => api<{ jobId: string }>("POST", `/api/apps/${d.name}/start`),
    onSuccess: (r) => {
      onStarted(r);
      void queryClient.invalidateQueries({ queryKey: ["apps"] });
    },
  });
  return (
    <section className="card" aria-label="Status">
      <p>
        <span className={`state state-${d.state}`} data-field="state">
          {STATE_LABEL[d.state]}
        </span>
        {d.stateReason ? <span className="muted"> {d.stateReason}</span> : null}
      </p>
      <dl>
        <dt>Address</dt>
        <dd>
          <code>{d.origin}</code>
        </dd>
        <dt>Source</dt>
        <dd>
          <a href={`https://github.com/${d.source.repo}/blob/${d.source.commit}/${d.source.path}`} target="_blank" rel="noreferrer">
            {d.source.repo}/{d.source.path}
          </a>{" "}
          at <code>{d.source.commit.slice(0, 12)}</code>
        </dd>
        {d.kitSource ? (
          <>
            <dt>Installation kit</dt>
            <dd>
              <a href={d.kitSource} target="_blank" rel="noreferrer">
                {d.kitSource.replace(/^https:\/\/github\.com\//, "")}
              </a>
            </dd>
          </>
        ) : null}
      </dl>
      <div className="actions">
        {d.interface && d.state !== "removed" ? (
          <Link className="button" to="/open/$name" params={{ name: d.name }} search={{}}>
            Open
          </Link>
        ) : null}
        {d.state === "failed" || d.state === "stopped" ? (
          <button type="button" onClick={() => start.mutate()} disabled={start.isPending}>
            Start
          </button>
        ) : null}
      </div>
      {start.isError ? (
        <p className="notice error" role="alert">
          {errorMessage(start.error)}
        </p>
      ) : null}
    </section>
  );
}

function Settings({ detail: d, onStarted }: { detail: Detail; onStarted: (r: { jobId: string }) => void }) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [replacing, setReplacing] = useState<Record<string, boolean>>({});
  const editable = d.settings.filter((s) => !s.derived);
  const save = useMutation({
    mutationFn: () => {
      const changed: Record<string, string | null> = {};
      for (const [name, value] of Object.entries(values)) changed[name] = value === "" ? null : value;
      return api<{ jobId: string }>("PUT", `/api/apps/${d.name}/settings`, { values: changed });
    },
    onSuccess: (r) => {
      setValues({});
      setReplacing({});
      onStarted(r);
      void queryClient.invalidateQueries({ queryKey: ["apps", d.name] });
    },
  });
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };
  if (editable.length === 0) return null;
  return (
    <section className="card" aria-labelledby="settings-heading">
      <h2 id="settings-heading">Settings</h2>
      <p className="muted">Saving restarts the services that use them. The app's data is kept.</p>
      <form onSubmit={onSubmit}>
        {editable.map((s) =>
          s.secret ? (
            <div key={s.name} className="secret" data-setting={s.name}>
              <div>
                <strong>{s.name}</strong> <span className="muted">{s.set ? (s.generated ? "Set, generated by Your Space" : "Set") : "Not set"}</span>
              </div>
              {replacing[s.name] ? (
                <label>
                  {`New value for ${s.name}`}
                  {s.generated ? (
                    <small className="error">
                      Your Space generated this value, and the app may have stored data with it. Replacing it may break the app.
                    </small>
                  ) : null}
                  <input
                    type="password"
                    autoComplete="off"
                    value={values[s.name] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [s.name]: e.target.value }))}
                  />
                </label>
              ) : (
                <button type="button" className="secondary" onClick={() => setReplacing((r) => ({ ...r, [s.name]: true }))} aria-label={`Replace ${s.name}`}>
                  Replace
                </button>
              )}
            </div>
          ) : (
            <label key={s.name}>
              {s.name}
              {s.publishedDefault ? <small>Default: {s.publishedDefault}</small> : null}
              <input
                type="text"
                autoComplete="off"
                value={values[s.name] ?? s.value ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [s.name]: e.target.value }))}
              />
            </label>
          ),
        )}
        {save.isError ? (
          <p className="notice error" role="alert">
            {errorMessage(save.error)}
          </p>
        ) : null}
        <div>
          <button type="submit" disabled={save.isPending || Object.keys(values).length === 0}>
            Save settings
          </button>
        </div>
      </form>
    </section>
  );
}

function when(iso: string): string {
  return new Date(iso).toLocaleString();
}

function Outbound({ detail: d, onStarted }: { detail: Detail; onStarted: (r: { jobId: string }) => void }) {
  const queryClient = useQueryClient();
  const [host, setHost] = useState("");
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["apps"] });
  const approveHost = useMutation({
    mutationFn: (h: string) => api<{ jobId: string }>("POST", `/api/apps/${d.name}/outbound`, { host: h }),
    onSuccess: (r) => {
      setHost("");
      onStarted(r);
      refresh();
    },
  });
  const removeHost = useMutation({
    mutationFn: (h: string) => api<{ jobId: string }>("DELETE", `/api/apps/${d.name}/outbound/${encodeURIComponent(h)}`),
    onSuccess: (r) => {
      onStarted(r);
      refresh();
    },
  });
  const approveRequest = useMutation({
    mutationFn: (id: string) => api<{ jobId: string }>("POST", `/api/apps/${d.name}/requests/${id}/approve`),
    onSuccess: (r) => {
      onStarted(r);
      refresh();
    },
  });
  const dismissRequest = useMutation({
    mutationFn: (id: string) => api<void>("POST", `/api/apps/${d.name}/requests/${id}/dismiss`),
    onSuccess: refresh,
  });
  const pending = d.requests.filter((r) => r.state === "pending");
  const failure = approveHost.error ?? removeHost.error ?? approveRequest.error ?? dismissRequest.error;

  return (
    <section className="card" aria-labelledby="outbound-heading">
      <h2 id="outbound-heading">Outbound access</h2>
      <p className="muted">The internet hosts {d.title} can reach. Everything else is blocked.</p>
      {d.outbound.length === 0 ? (
        <p>No internet access.</p>
      ) : (
        <ul aria-label="Approved hosts" className="rows">
          {d.outbound.map((o) => (
            <li key={o.host} data-host={o.host}>
              <code>{o.host}</code> <span className="muted small">{o.source === "kit" ? "from the installation kit" : "approved by you"}</span>
              <button type="button" className="secondary" onClick={() => removeHost.mutate(o.host)} aria-label={`Remove ${o.host}`} disabled={removeHost.isPending}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      <h3 id="requests-heading">Access requests</h3>
      {pending.length === 0 ? (
        <p className="muted">No requests waiting.</p>
      ) : (
        <ul aria-labelledby="requests-heading" className="rows">
          {pending.map((r) => (
            <li key={r.id} data-request={r.host}>
              <div>
                <code>{r.host}</code>
                <div className="muted small">
                  Tried {r.attempts} time{r.attempts === 1 ? "" : "s"}, last at {when(r.lastSeen)}
                </div>
              </div>
              <div className="actions">
                <button type="button" onClick={() => approveRequest.mutate(r.id)} aria-label={`Approve ${r.host}`} disabled={approveRequest.isPending}>
                  Approve
                </button>
                <button type="button" className="secondary" onClick={() => dismissRequest.mutate(r.id)} aria-label={`Dismiss ${r.host}`} disabled={dismissRequest.isPending}>
                  Dismiss
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <form
        className="inline"
        onSubmit={(e) => {
          e.preventDefault();
          approveHost.mutate(host);
        }}
      >
        <label>
          Approve a host
          <input type="text" value={host} onChange={(e) => setHost(e.target.value)} placeholder="api.example.com" autoComplete="off" />
        </label>
        <button type="submit" disabled={!host.trim() || approveHost.isPending}>
          Approve host
        </button>
      </form>
      {failure ? (
        <p className="notice error" role="alert">
          {errorMessage(failure)}
        </p>
      ) : null}
    </section>
  );
}

function Advanced({ detail: d, onStarted }: { detail: Detail; onStarted: (r: { jobId: string }) => void }) {
  const queryClient = useQueryClient();
  const services = Object.keys(d.limits).sort();
  const [limits, setLimits] = useState<Record<string, { memory: string; cpus: string }>>({});
  const [logService, setLogService] = useState(services[0] ?? "");
  const [lines, setLines] = useState<string[] | null>(null);

  const saveLimits = useMutation({
    mutationFn: () => {
      const body: Record<string, { memory?: number; cpus?: number }> = {};
      for (const [service, l] of Object.entries(limits)) {
        body[service] = {};
        if (l.memory !== "") body[service].memory = Math.round(Number(l.memory) * MIB);
        if (l.cpus !== "") body[service].cpus = Number(l.cpus);
      }
      return api<{ jobId: string }>("PUT", `/api/apps/${d.name}/limits`, { limits: body });
    },
    onSuccess: (r) => {
      setLimits({});
      onStarted(r);
      void queryClient.invalidateQueries({ queryKey: ["apps", d.name] });
    },
  });
  const loadLogs = useMutation({
    mutationFn: (service: string) => api<{ lines: string[] }>("GET", `/api/apps/${d.name}/logs?service=${encodeURIComponent(service)}`),
    onSuccess: (r) => setLines(r.lines),
  });
  const stateOf = (service: string) => d.services.find((s) => s.name === service);
  const value = (service: string, field: "memory" | "cpus") =>
    limits[service]?.[field] ?? (field === "memory" ? String(Math.round(d.limits[service]!.memory / MIB)) : String(d.limits[service]!.cpus));
  const setValue = (service: string, field: "memory" | "cpus", v: string) =>
    setLimits((all) => {
      const current = all[service] ?? { memory: value(service, "memory"), cpus: value(service, "cpus") };
      return { ...all, [service]: { ...current, [field]: v } };
    });

  return (
    <section className="card">
      <details>
        <summary>
          <h2 className="inline-heading">Advanced</h2>
        </summary>
        <h3>Services</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveLimits.mutate();
          }}
        >
          <table>
            <thead>
              <tr>
                <th scope="col">Service</th>
                <th scope="col">State</th>
                <th scope="col">Memory limit (MiB)</th>
                <th scope="col">CPUs</th>
              </tr>
            </thead>
            <tbody>
              {services.map((service) => {
                const s = stateOf(service);
                return (
                  <tr key={service} data-service={service}>
                    <td>{service}</td>
                    <td>
                      {s ? `${s.state}${s.health ? ` (${s.health})` : ""}${s.oomKilled ? ", ran out of memory" : ""}` : "not running"}
                    </td>
                    <td>
                      <input
                        type="number"
                        min={32}
                        step={1}
                        aria-label={`Memory limit for ${service} in MiB`}
                        value={value(service, "memory")}
                        onChange={(e) => setValue(service, "memory", e.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0.1}
                        step={0.1}
                        aria-label={`CPUs for ${service}`}
                        value={value(service, "cpus")}
                        onChange={(e) => setValue(service, "cpus", e.target.value)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="muted small">Changing a limit restarts that service.</p>
          {saveLimits.isError ? (
            <p className="notice error" role="alert">
              {errorMessage(saveLimits.error)}
            </p>
          ) : null}
          <button type="submit" disabled={saveLimits.isPending || Object.keys(limits).length === 0}>
            Save limits
          </button>
        </form>
        <h3>Logs</h3>
        <form
          className="inline"
          onSubmit={(e) => {
            e.preventDefault();
            loadLogs.mutate(logService);
          }}
        >
          <label>
            Service
            <select value={logService} onChange={(e) => setLogService(e.target.value)}>
              {[...services, "ys-egress"].map((s) => (
                <option key={s} value={s}>
                  {s === "ys-egress" ? "ys-egress (outbound proxy)" : s}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={loadLogs.isPending}>
            Show logs
          </button>
        </form>
        {loadLogs.isError ? (
          <p className="notice error" role="alert">
            {errorMessage(loadLogs.error)}
          </p>
        ) : null}
        {lines ? <pre aria-label="Logs" className="logs">{lines.length ? lines.join("\n") : "No log lines."}</pre> : null}
        <h3>Changes Your Space made to the app's file</h3>
        <ul>
          {d.adaptations.map((a, i) => (
            <li key={i}>
              <strong>{a.service}</strong>: {a.detail}
            </li>
          ))}
        </ul>
        <h3>Images</h3>
        <ul>
          {Object.entries(d.images).map(([ref, { digest }]) => (
            <li key={ref}>
              <code>{ref}</code> <code className="muted">{digest}</code>
            </li>
          ))}
        </ul>
        <p className="muted small">
          Memory each app uses now is on the <Link to="/engine">Engine</Link> page.
        </p>
      </details>
    </section>
  );
}
