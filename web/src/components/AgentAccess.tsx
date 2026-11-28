import { useState } from "react";
import { api } from "../apps-api.ts";
import {
  agentPath,
  useAgentAction,
  type Agent,
  type AgentGrant,
  type AgentInstallation,
  type AskRule,
} from "../agents-api.ts";

export function ActionFeedback({ action }: { action: ReturnType<typeof useAgentAction> }) {
  return (
    <>
      {action.error && (
        <p className="notice error" role="alert">
          {action.error}
        </p>
      )}
      {action.message && <p role="status">{action.message}</p>}
    </>
  );
}

/** Why agents can't reach the app, and what brings access back (spec 018 decision 11). */
export function AgentAccessProblem({ app }: { app: Pick<AgentInstallation, "problem"> }) {
  if (app.problem !== "old_format") return null;
  return (
    <p className="notice warning">
      Agent access is unavailable: this app's kit lists roles and routes, the format before agent access per
      app. It returns, with its app keys and agents' access as they are, once the app runs a kit that names
      its API with <code>api</code>. Removing and installing the app again starts with no agent access.
    </p>
  );
}

/** The app keys bound to an installation, shared across its agents. Your Space attaches them; agents never see them. */
export function AppConnection({ app }: { app: AgentInstallation }) {
  const action = useAgentAction();
  const [values, setValues] = useState<Record<string, string>>({});
  const filled = Object.fromEntries(Object.entries(values).filter(([, value]) => value));
  const path = agentPath + "/installations/" + encodeURIComponent(app.id);
  const bound = app.credentials.some((credential) => credential.bound);
  const label = (name: string, isBound: boolean) =>
    app.named
      ? isBound
        ? `Replacement ${name} key (optional)`
        : `App key: ${name}`
      : isBound
        ? "Replacement app key (optional)"
        : "App key";
  return (
    <details className="agent-details">
      <summary>
        {app.title || app.name} · {app.problem ? "Unavailable" : bound ? "Key saved" : "No key"}
      </summary>
      <p className="muted small">
        Kit source: <code>{app.source || "Unknown"}</code>
        {app.api && (
          <>
            {" "}
            · API: <code>{app.api}</code>
          </>
        )}
      </p>
      <AgentAccessProblem app={app} />
      {!app.problem && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              await api("PUT", path, {
                revision: app.revision,
                ...(app.named
                  ? { credentials: filled }
                  : filled[app.credentials[0]!.name]
                    ? { credential: filled[app.credentials[0]!.name] }
                    : {}),
              });
              setValues({});
            }, "Keys saved.");
          }}
        >
          {app.credentials.map(({ name, bound: isBound }) => (
            <label key={name}>
              {label(name, isBound)}
              <input
                type="password"
                autoComplete="new-password"
                value={values[name] ?? ""}
                maxLength={4096}
                onChange={(e) => setValues({ ...values, [name]: e.target.value })}
              />
            </label>
          ))}
          <p className="muted small">
            An agent can do what its key's role in the app allows. Give an agent that should do less a narrower key.
            Replacing a key keeps the agents that use it, on the new key; Your Space stops using the old one at
            once. Revoke the old key in the app too: Your Space can't.
          </p>
          <div className="actions">
            <button disabled={action.busy || !Object.keys(filled).length}>Save keys</button>
            {bound && (
              <button
                className="danger-outline"
                type="button"
                disabled={action.busy}
                onClick={() => {
                  if (window.confirm("Disconnect this app's keys for all agents? Revoke them in the app too."))
                    void action.run(async () => {
                      await api("PUT", path, {
                        revision: app.revision,
                        ...(app.named
                          ? { credentials: Object.fromEntries(app.credentials.map(({ name }) => [name, null])) }
                          : { credential: null }),
                      });
                      setValues({});
                    }, "Keys disconnected.");
                }}
              >
                Disconnect
              </button>
            )}
          </div>
        </form>
      )}
      <ActionFeedback action={action} />
    </details>
  );
}

const METHODS: AskRule["method"][] = ["GET", "POST", "PATCH", "PUT", "DELETE"];

/** One agent's access to one app: the app key it uses, and the routes that ask the owner first. */
export function GrantEditor({ agent, app, grant }: { agent: Agent; app: AgentInstallation; grant?: AgentGrant }) {
  const action = useAgentAction();
  const choices = app.credentials.filter((credential) => credential.bound).map((credential) => credential.name);
  const [credential, setCredential] = useState(grant?.credential ?? "");
  const [asks, setAsks] = useState<AskRule[]>(grant?.asks ?? []);
  const [method, setMethod] = useState<AskRule["method"]>("DELETE");
  const [askPath, setAskPath] = useState("");
  const path = agentPath + "/" + encodeURIComponent(agent.id) + "/grants/" + encodeURIComponent(app.id);
  const save = (next: string | null) =>
    action.run(
      async () => {
        await api("PUT", path, { credential: next, asks, bindingRevision: app.revision, revision: grant?.revision ?? 0 });
      },
      next ? "Agent access saved." : "Agent access removed.",
    );
  return (
    <details className="agent-details">
      <summary>
        {app.title || app.name} ·{" "}
        {grant ? (grant.credential ? `Uses the ${grant.credential} key` : "Pick a key") : "No access"}
      </summary>
      <AgentAccessProblem app={app} />
      {app.problem && grant && (
        <div className="actions">
          <button type="button" className="danger-outline" disabled={action.busy} onClick={() => void save(null)}>
            Remove access
          </button>
        </div>
      )}
      {!app.problem && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save(credential || null);
          }}
        >
          {choices.length ? (
            <label>
              App key this agent uses
              <select value={credential} onChange={(e) => setCredential(e.target.value)}>
                <option value="">No access</option>
                {choices.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="muted">Save an app key under App connections first.</p>
          )}
          {grant && !grant.credential && (
            <p className="notice warning">This agent's access waits for you to pick the app key it uses.</p>
          )}
          <p className="muted small">
            The agent can call any route under <code>{app.api}</code> that its key allows. Nothing asks you first
            unless you add a route that does; <code>*</code> stands for one path segment.
          </p>
          <fieldset>
            <legend>Routes that ask first</legend>
            {asks.length ? (
              <ul className="ask-rules">
                {asks.map((rule, index) => (
                  <li key={rule.method + " " + rule.path}>
                    <code>
                      {rule.method} {rule.path}
                    </code>{" "}
                    <button
                      type="button"
                      className="danger-outline"
                      aria-label={`Remove ${rule.method} ${rule.path}`}
                      onClick={() => setAsks(asks.filter((_, other) => other !== index))}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">None: every call runs directly.</p>
            )}
            <div className="ask-rule-new">
              <select aria-label="Method that asks" value={method} onChange={(e) => setMethod(e.target.value as AskRule["method"])}>
                {METHODS.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </select>
              <input
                aria-label="Path that asks"
                placeholder={(app.api === "/" ? "" : app.api) + "/items/*"}
                value={askPath}
                maxLength={512}
                onChange={(e) => setAskPath(e.target.value)}
              />
              <button
                type="button"
                disabled={!askPath.startsWith("/")}
                onClick={() => {
                  setAsks([...asks, { method, path: askPath }]);
                  setAskPath("");
                }}
              >
                Add
              </button>
            </div>
          </fieldset>
          <div className="actions">
            <button disabled={action.busy || !credential}>Save agent access</button>
            {grant && (
              <button type="button" className="danger-outline" disabled={action.busy} onClick={() => void save(null)}>
                Remove access
              </button>
            )}
          </div>
        </form>
      )}
      <ActionFeedback action={action} />
    </details>
  );
}
