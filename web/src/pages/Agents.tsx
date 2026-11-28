import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, errorMessage } from "../apps-api.ts";
import { agentPath, useAgentAction, type ActivityEntry, type Agent, type AgentDashboard } from "../agents-api.ts";
import { ActionFeedback, AppConnection, GrantEditor } from "../components/AgentAccess.tsx";

export function Agents() {
  const dashboard = useQuery({
    queryKey: ["agents", "dashboard"],
    queryFn: () => api<AgentDashboard>("GET", agentPath + "/dashboard"),
    gcTime: 0,
    retry: false,
    refetchInterval: 5000,
  });
  const [selected, setSelected] = useState("");
  const [name, setName] = useState("");
  const create = useAgentAction();
  const data = dashboard.data;
  const agent = data?.agents.find((item) => item.id === selected) ?? data?.agents[0];
  return (
    <main className="page agent-page">
      <h1>Agents</h1>
      {dashboard.isError ? (
        <div className="notice error" role="alert">
          {errorMessage(dashboard.error)}{" "}
          <button className="secondary" onClick={() => void dashboard.refetch()}>
            Retry
          </button>
        </div>
      ) : !data ? (
        <p>Loading agents…</p>
      ) : (
        <>
          <Requests data={data} />
          <section className="card" aria-label="Manage agents">
            <form
              className="inline"
              onSubmit={(event) => {
                event.preventDefault();
                void create.run(async () => {
                  const result = await api<{ id?: string }>("POST", agentPath, { name: name.trim() });
                  if (result?.id) setSelected(result.id);
                  setName("");
                }, "Agent created.");
              }}
            >
              <label>
                New agent name
                <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <button disabled={create.busy || !name.trim()}>Create agent</button>
            </form>
            <ActionFeedback action={create} />
            {agent ? (
              <>
                <label className="agent-picker">
                  Manage agent
                  <select value={agent.id} onChange={(e) => setSelected(e.target.value)}>
                    {data.agents.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                        {item.disabled ? " (disabled)" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <AgentSettings key={agent.id} agent={agent} data={data} />
              </>
            ) : (
              <p className="muted">Create an agent to issue a key and grant app access.</p>
            )}
          </section>
          <section className="card" aria-label="App connections">
            <h2>App connections</h2>
            {data.installations.length ? (
              <>
                <p className="muted">
                  Save the app keys agents use. Your Space attaches the key an agent uses to each call it makes;
                  the agent never sees it.
                </p>
                {data.installations.map((app) => (
                  <AppConnection key={app.id + ":" + app.revision} app={app} />
                ))}
              </>
            ) : (
              <p className="muted">
                No installed app offers agent access. Install an app whose kit names its API to connect it here.
              </p>
            )}
          </section>
          <Activity data={data} />
        </>
      )}
    </main>
  );
}

function AgentSettings({ agent, data }: { agent: Agent; data: AgentDashboard }) {
  const action = useAgentAction();
  const [newName, setNewName] = useState(agent.name);
  const [secret, setSecret] = useState("");
  const [reveal, setReveal] = useState(false);
  const path = agentPath + "/" + encodeURIComponent(agent.id);
  function issue(rotateId?: string) {
    const endpoint = path + "/keys" + (rotateId ? "/" + encodeURIComponent(rotateId) + "/rotate" : "");
    void action.run(async () => {
      setSecret("");
      setReveal(false);
      const result = await api<{ key: string }>("POST", endpoint, {});
      setSecret(result.key);
    }, "Agent key issued.");
  }
  if (agent.disabled) return <p className="notice">This agent is disabled. Its keys cannot be used.</p>;
  return (
    <>
      <details className="agent-details">
        <summary>Identity settings</summary>
        <p className="small">
          Agent ID <code>{agent.id}</code>
        </p>
        <form
          className="inline"
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              await api("PATCH", path, { name: newName.trim() });
            }, "Agent renamed.");
          }}
        >
          <label>
            Agent name
            <input value={newName} required maxLength={80} onChange={(e) => setNewName(e.target.value)} />
          </label>
          <button className="secondary" disabled={action.busy || !newName.trim() || newName.trim() === agent.name}>
            Rename
          </button>
          <button
            type="button"
            className="danger-outline"
            disabled={action.busy}
            onClick={() => {
              if (window.confirm("Disable this agent and stop all its keys from working?"))
                void action.run(async () => {
                  await api("PATCH", path, { disabled: true });
                  setSecret("");
                }, "Agent disabled.");
            }}
          >
            Disable agent
          </button>
        </form>
      </details>
      <h3>Agent keys</h3>
      {agent.keys.length ? (
        <ul className="rows" aria-label="Agent keys">
          {agent.keys.map((key) => (
            <li key={key.id}>
              <code>{key.id}</code>
              {key.revoked ? (
                <span className="muted">Revoked</span>
              ) : (
                <span className="actions">
                  <button
                    className="secondary"
                    disabled={action.busy}
                    onClick={() => {
                      if (window.confirm("Rotate this key? Its current value will stop working.")) issue(key.id);
                    }}
                  >
                    Rotate
                  </button>
                  <button
                    className="danger-outline"
                    disabled={action.busy}
                    onClick={() => {
                      if (window.confirm("Revoke this key? Other keys and app grants stay active."))
                        void action.run(async () => {
                          await api("POST", path + "/keys/" + encodeURIComponent(key.id) + "/revoke", {});
                          setSecret("");
                        }, "Key revoked.");
                    }}
                  >
                    Revoke
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No keys issued.</p>
      )}
      <button className="secondary" disabled={action.busy} onClick={() => issue()}>
        Issue key
      </button>
      {secret && (
        <div className="notice secret" aria-label="New key">
          <label>
            New agent key
            <input
              aria-label="New agent key"
              type={reveal ? "text" : "password"}
              readOnly
              spellCheck={false}
              autoComplete="off"
              value={secret}
              onFocus={(e) => e.target.select()}
            />
          </label>
          <p className="small">
            Save this key in the agent’s private environment. It is available only here, until dismissed.
          </p>
          <div className="actions">
            <button type="button" className="secondary" onClick={() => setReveal(!reveal)}>
              {reveal ? "Hide" : "Show"} key
            </button>
            <button
              type="button"
              onClick={() => {
                setSecret("");
                setReveal(false);
              }}
            >
              Dismiss key
            </button>
          </div>
        </div>
      )}
      <ActionFeedback action={action} />
      <h3>App access</h3>
      {data.installations.length ? (
        data.installations.map((app) => {
          const grant = agent.grants.find((item) => item.installationId === app.id);
          return (
            <GrantEditor
              key={[agent.id, app.id, app.revision, grant?.revision ?? 0].join(":")}
              agent={agent}
              app={app}
              grant={grant}
            />
          );
        })
      ) : (
        <p className="muted">This agent has no app access.</p>
      )}
    </>
  );
}

function Requests({ data }: { data: AgentDashboard }) {
  const action = useAgentAction();
  return (
    <section className="card" aria-label="Pending approvals">
      <h2>Pending approvals{data.requests.length > 0 && <span className="badge">{data.requests.length}</span>}</h2>
      {data.requests.length ? (
        data.requests.map((request) => {
          const app = data.installations.find((item) => item.id === request.installationId);
          const agent = data.agents.find((item) => item.id === request.agentId);
          const call = request.input as { method?: string; path?: string } | undefined;
          function decide(approve: boolean) {
            void action.run(
              async () => {
                await api("POST", agentPath + "/requests/" + encodeURIComponent(request.id) + "/decision", {
                  approve,
                  revision: request.revision,
                });
              },
              approve ? "Approval recorded. Check activity for the result." : "Request denied.",
            );
          }
          return (
            <details className="agent-details" key={request.id + ":" + request.revision}>
              <summary>
                {agent?.name ?? request.agentId} · {app?.title || app?.name || request.installationId} ·{" "}
                {request.actionId}
              </summary>
              <dl className="small">
                <dt>Request</dt>
                <dd>
                  <code>{request.id}</code>
                </dd>
                {call?.method && call.path && (
                  <>
                    <dt>Call</dt>
                    <dd>
                      <code>
                        {call.method} {call.path}
                      </code>
                    </dd>
                  </>
                )}
                {request.credentialId && (
                  <>
                    <dt>Key ID</dt>
                    <dd>
                      <code>{request.credentialId}</code>
                    </dd>
                  </>
                )}
                {request.expiresAt && (
                  <>
                    <dt>Expires</dt>
                    <dd>{new Date(request.expiresAt).toLocaleString()}</dd>
                  </>
                )}
              </dl>
              <h3>Request input</h3>
              <pre>{JSON.stringify(request.input, null, 2)}</pre>
              <div className="actions">
                <button disabled={action.busy} onClick={() => decide(true)}>
                  Approve once
                </button>
                <button className="danger-outline" disabled={action.busy} onClick={() => decide(false)}>
                  Deny
                </button>
              </div>
            </details>
          );
        })
      ) : (
        <p className="muted">No requests awaiting approval.</p>
      )}
      <ActionFeedback action={action} />
    </section>
  );
}

function Activity({ data }: { data: AgentDashboard }) {
  const [cursors, setCursors] = useState<string[]>([]);
  const before = cursors.at(-1);
  const query = useQuery({
    queryKey: ["agents", "activity", before ?? ""],
    queryFn: () =>
      api<{ events: ActivityEntry[]; nextCursor: string | null }>(
        "GET",
        agentPath + "/activity" + (before ? "?before=" + encodeURIComponent(before) : ""),
      ),
    refetchInterval: before ? false : 5000,
    gcTime: 0,
    retry: false,
  });
  return (
    <section className="card" aria-label="Agent activity">
      <h2>Activity</h2>
      {query.isError ? (
        <p role="alert" className="notice error">
          {errorMessage(query.error)}{" "}
          <button className="secondary" onClick={() => void query.refetch()}>
            Retry
          </button>
        </p>
      ) : query.isPending ? (
        <p>Loading activity…</p>
      ) : !query.data.events.length ? (
        <p className="muted">No recorded requests.</p>
      ) : (
        <ul className="rows agent-activity">
          {query.data.events.map((event) => (
            <li key={event.id}>
              <details>
                <summary>
                  <time dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleString()}</time>
                  {" · "}
                  {data.agents.find((a) => a.id === event.agentId)?.name ?? event.agentId}
                  {" · "}
                  {event.actionId}
                  {" · "}
                  {event.status}
                </summary>
                <dl className="small">
                  <dt>Request</dt>
                  <dd>
                    <code>{event.id}</code>
                  </dd>
                  <dt>App</dt>
                  <dd>
                    {data.installations.find((app) => app.id === event.installationId)?.name ??
                      event.installationId}
                  </dd>
                  <dt>Agent ID</dt>
                  <dd>{event.agentId}</dd>
                  <dt>Delegated by</dt>
                  <dd>{event.ownerId}</dd>
                </dl>
              </details>
            </li>
          ))}
        </ul>
      )}
      <div className="actions">
        {!!cursors.length && (
          <button type="button" className="secondary" onClick={() => setCursors(cursors.slice(0, -1))}>
            Newer requests
          </button>
        )}
        {query.data?.nextCursor && (
          <button
            type="button"
            className="secondary"
            onClick={() => setCursors([...cursors, query.data.nextCursor!])}
          >
            Older requests
          </button>
        )}
      </div>
    </section>
  );
}
