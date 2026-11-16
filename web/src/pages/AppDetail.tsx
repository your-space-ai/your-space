// One app's details (journey 002, US3): its state, its source, and what Your Space changed and
// runs.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { api, appQuery, errorMessage, STATE_LABEL, type AppDetail as Detail } from "../apps-api.ts";
import { JobProgress } from "../components/JobProgress.tsx";

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
      <Advanced detail={d} />
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

function Advanced({ detail: d }: { detail: Detail }) {
  return (
    <section className="card">
      <details>
        <summary>
          <h2 className="inline-heading">Advanced</h2>
        </summary>
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
