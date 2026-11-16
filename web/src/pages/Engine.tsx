// The Engine page (journey 002, US3 scenario 6, FR-012a, FR-021a): the engine Your Space runs apps
// on, its resources, and how much of them each app uses, whatever kind of engine it is.
import { useQuery } from "@tanstack/react-query";
import { engineQuery, errorMessage, formatBytes } from "../apps-api.ts";

export function Engine() {
  const engine = useQuery(engineQuery);
  return (
    <main className="page" data-state="engine">
      <h1>Engine</h1>
      <p className="muted">Where Your Space runs your apps. Its processors and memory are your workspace's resources.</p>
      {engine.isError ? (
        <p className="notice error" role="alert">
          {errorMessage(engine.error)}
        </p>
      ) : null}
      {engine.isPending ? <p className="muted">Loading…</p> : null}
      {engine.data ? (
        <>
          <dl>
            <dt>Connection</dt>
            <dd>
              <code>{engine.data.connection}</code>
            </dd>
            <dt>Status</dt>
            <dd data-field="reachable">{engine.data.reachable ? (engine.data.stopping ? "Stopping its apps" : "Reachable") : "Not reachable"}</dd>
            {engine.data.reachable ? (
              <>
                <dt>Version</dt>
                <dd data-field="version">{engine.data.version}</dd>
                <dt>Processor</dt>
                <dd>{engine.data.arch}</dd>
                <dt>CPUs</dt>
                <dd data-field="cpus">{engine.data.cpus}</dd>
                <dt>Memory</dt>
                <dd data-field="memory">{engine.data.memory ? `${(engine.data.memory / 1024 ** 3).toFixed(1)} GiB` : "—"}</dd>
              </>
            ) : null}
          </dl>
          <h2>Apps</h2>
          {engine.data.apps.length === 0 ? (
            <p className="muted">No app is installed.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th scope="col">App</th>
                  <th scope="col">Memory</th>
                  <th scope="col">CPU</th>
                </tr>
              </thead>
              <tbody>
                {engine.data.apps.map((a) => (
                  <tr key={a.name} data-app={a.name}>
                    <td>{a.title}</td>
                    <td>{formatBytes(a.memory)}</td>
                    <td>{a.cpuPercent === null ? "—" : `${a.cpuPercent}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      ) : null}
    </main>
  );
}
