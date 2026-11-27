import { useState } from "react";
import { api } from "../apps-api.ts";
import {
  agentPath,
  useAgentAction,
  type Agent,
  type AgentGrant,
  type AgentInstallation,
  type Approval,
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

function RoleChoices({
  app,
  choices,
  selected,
  change,
}: {
  app: AgentInstallation;
  choices: string[];
  selected: string[];
  change: (ids: string[]) => void;
}) {
  if (!choices.length) return <p className="muted">No roles are available.</p>;
  return (
    <div className="role-choices">
      {choices.map((id) => {
        const role = app.roles[id];
        if (!role) return null;
        return (
          <label className="checkbox" key={id}>
            <input
              type="checkbox"
              checked={selected.includes(id)}
              onChange={(e) =>
                change(e.target.checked ? [...selected, id] : selected.filter((value) => value !== id))
              }
            />{" "}
            {role.title || id}
            {app.named && app.roleCredentials[id] && <small>Uses the {app.roleCredentials[id]} credential</small>}
            <small>
              {role.routes.map((routeId) => {
                const route = app.routes[routeId];
                return route ? (
                  <code key={routeId}>
                    {route.method} {route.path}
                  </code>
                ) : null;
              })}
            </small>
          </label>
        );
      })}
    </div>
  );
}

/** Installation-level credential and role ceiling, shared across all of its agents. */
export function AppConnection({ app }: { app: AgentInstallation }) {
  const action = useAgentAction();
  const [credential, setCredential] = useState("");
  // A kit that names its credentials takes a value for each, bound separately (spec 017).
  const [named, setNamed] = useState<Record<string, string>>({});
  const [roles, setRoles] = useState(app.enabledRoles);
  const filled = Object.fromEntries(Object.entries(named).filter(([, value]) => value));
  const path = agentPath + "/installations/" + encodeURIComponent(app.id);
  return (
    <details className="agent-details">
      <summary>
        {app.title || app.name} · {app.bound ? "Credential saved" : "No credential"}
      </summary>
      <p className="muted small">
        Kit source: <code>{app.source || "Unknown"}</code>
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            await api("PUT", path, {
              enabledRoles: roles,
              revision: app.revision,
              ...(app.named
                ? Object.keys(filled).length
                  ? { credentials: filled }
                  : {}
                : credential
                  ? { credential }
                  : {}),
            });
            setCredential("");
            setNamed({});
          }, "Connection saved.");
        }}
      >
        {app.named ? (
          app.credentials.map(({ name, bound }) => (
            <label key={name}>
              {bound ? `Replacement ${name} credential (optional)` : `App credential: ${name}`}
              <input
                type="password"
                autoComplete="new-password"
                value={named[name] ?? ""}
                maxLength={4096}
                onChange={(e) => setNamed({ ...named, [name]: e.target.value })}
              />
            </label>
          ))
        ) : (
          <label>
            {app.bound ? "Replacement app credential (optional)" : "App credential"}
            <input
              type="password"
              autoComplete="new-password"
              value={credential}
              required={!app.bound}
              maxLength={4096}
              onChange={(e) => setCredential(e.target.value)}
            />
          </label>
        )}
        {app.named && app.credentials.some(({ name, bound }) => bound && filled[name]) && (
          <p className="notice warning">
            Replacing a credential withdraws the roles that use it from existing agent grants. Grant them again after saving.
          </p>
        )}
        {!app.named && app.bound && credential && (
          <p className="notice warning">
            Replacing this credential clears existing agent grants. Review and grant access again after saving.
          </p>
        )}
        <fieldset>
          <legend>Roles available for delegation</legend>
          <RoleChoices app={app} choices={Object.keys(app.roles)} selected={roles} change={setRoles} />
        </fieldset>
        <div className="actions">
          <button disabled={action.busy}>Save connection</button>
          {app.bound && (
            <button
              className="danger-outline"
              type="button"
              disabled={action.busy}
              onClick={() => {
                if (window.confirm("Disconnect this app credential for all agents?"))
                  void action.run(async () => {
                    await api("PUT", path, {
                      enabledRoles: [],
                      revision: app.revision,
                      ...(app.named
                        ? { credentials: Object.fromEntries(app.credentials.map(({ name }) => [name, null])) }
                        : { credential: null }),
                    });
                    setCredential("");
                    setNamed({});
                  }, "Credential disconnected.");
              }}
            >
              Disconnect
            </button>
          )}
        </div>
      </form>
      <ActionFeedback action={action} />
    </details>
  );
}

export function GrantEditor({ agent, app, grant }: { agent: Agent; app: AgentInstallation; grant?: AgentGrant }) {
  const action = useAgentAction();
  const [roles, setRoles] = useState(grant?.roles ?? []);
  const [overrides, setOverrides] = useState<Record<string, Approval>>(grant?.overrides ?? {});
  const routes = [...new Set(roles.flatMap((id) => app.roles[id]?.routes ?? []))].sort();
  return (
    <details className="agent-details">
      <summary>
        {app.title || app.name} ·{" "}
        {grant?.roles.length ? grant.roles.map((id) => app.roles[id]?.title || id).join(", ") : "No access"}
      </summary>
      {!app.bound ? (
        <p className="muted">Connect a credential for this app below.</p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void action.run(async () => {
              await api(
                "PUT",
                agentPath + "/" + encodeURIComponent(agent.id) + "/grants/" + encodeURIComponent(app.id),
                {
                  roles,
                  overrides: Object.fromEntries(Object.entries(overrides).filter(([id]) => routes.includes(id))),
                  bindingRevision: app.revision,
                  revision: grant?.revision ?? 0,
                },
              );
            }, "Agent access saved.");
          }}
        >
          <fieldset>
            <legend>Granted roles</legend>
            <RoleChoices app={app} choices={app.enabledRoles} selected={roles} change={setRoles} />
          </fieldset>
          {routes.map((id) => {
            const route = app.routes[id];
            if (!route) return null;
            // A write nobody set asks first, as the gateway does (spec 017).
            const fallback = route.approval ?? (route.method === "GET" ? "allow" : "ask");
            const asks = overrides[id] ?? fallback;
            return (
              <label className="agent-route" key={id}>
                <span>
                  {id}{" "}
                  <code>
                    {route.method} {route.path}
                  </code>
                </span>
                <select
                  aria-label={"Approval for " + id}
                  value={overrides[id] ?? ""}
                  onChange={(e) => {
                    const next = { ...overrides };
                    if (e.target.value) next[id] = e.target.value as Approval;
                    else delete next[id];
                    setOverrides(next);
                  }}
                >
                  <option value="">Use default ({fallback})</option>
                  <option value="ask">Ask</option>
                  <option value="allow">Allow</option>
                </select>
                <small>{asks === "ask" ? "Approval required." : "Runs directly."}</small>
              </label>
            );
          })}
          <div>
            <button disabled={action.busy}>Save agent access</button>
          </div>
        </form>
      )}
      <ActionFeedback action={action} />
    </details>
  );
}
