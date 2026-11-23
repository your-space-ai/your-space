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
import { Notice, useConfirm } from "../ui/index.ts";

export function ActionFeedback({ action }: { action: ReturnType<typeof useAgentAction> }) {
  return (
    <>
      {action.error && (
        <Notice tone="danger" role="alert">
          {action.error}
        </Notice>
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
  const [confirm, confirmation] = useConfirm();
  const [credential, setCredential] = useState("");
  const [roles, setRoles] = useState(app.enabledRoles);
  const reviewUrl = app.reviewedBy?.startsWith("https://github.com/") ? app.reviewedBy : null;
  const path = agentPath + "/installations/" + encodeURIComponent(app.id);
  return (
    <details className="agent-details">
      <summary>
        {app.title || app.name} · {app.bound ? "Credential saved" : "No credential"}
      </summary>
      <p className="muted small">
        Kit source: <code>{app.source || "Unknown"}</code>
      </p>
      <p className="small">
        {reviewUrl ? (
          <a href={reviewUrl} target="_blank" rel="noreferrer">
            Community review for this kit revision
          </a>
        ) : (
          "No verified review for this kit revision."
        )}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void action.run(async () => {
            await api("PUT", path, {
              enabledRoles: roles,
              revision: app.revision,
              ...(credential ? { credential } : {}),
            });
            setCredential("");
          }, "Connection saved.");
        }}
      >
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
        {app.bound && credential && (
          <Notice tone="warning">
            Replacing this credential clears existing agent grants. Review and grant access again after saving.
          </Notice>
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
              onClick={async () => {
                if (await confirm({ title: "Disconnect this app credential for all agents?", confirmLabel: "Disconnect" }))
                  void action.run(async () => {
                    await api("PUT", path, { enabledRoles: [], credential: null, revision: app.revision });
                    setCredential("");
                  }, "Credential disconnected.");
              }}
            >
              Disconnect
            </button>
          )}
        </div>
      </form>
      {confirmation}
      <ActionFeedback action={action} />
    </details>
  );
}

export function GrantEditor({ agent, app, grant }: { agent: Agent; app: AgentInstallation; grant?: AgentGrant }) {
  const action = useAgentAction();
  const [roles, setRoles] = useState(grant?.roles ?? []);
  const [allWrites, setAllWrites] = useState(grant?.askAllWrites ?? false);
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
                  askAllWrites: allWrites,
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
          <label className="checkbox">
            <input type="checkbox" checked={allWrites} onChange={(e) => setAllWrites(e.target.checked)} /> Ask for
            all writes
            <small>Requires approval even for writes set to Allow.</small>
          </label>
          {routes.map((id) => {
            const route = app.routes[id];
            if (!route) return null;
            const write = route.effect === "write" || !["GET", "HEAD"].includes(route.method);
            const asks = overrides[id] ?? route.approval ?? (write ? "ask" : "allow");
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
                  <option value="">Use default ({route.approval ?? (write ? "ask" : "allow")})</option>
                  <option value="ask">Ask</option>
                  <option value="allow">Allow</option>
                </select>
                <small>
                  {allWrites && write
                    ? "Approval required by Ask for all writes."
                    : asks === "ask"
                      ? "Approval required."
                      : "Runs directly."}
                </small>
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
