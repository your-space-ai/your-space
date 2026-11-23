import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { api, errorMessage } from "../apps-api.ts";
import { homeQuery, type HomeState, type ReadGrant } from "../home-api.ts";
import { sessionQuery } from "../queries.ts";
import { Notice } from "../ui/index.ts";

type Settings = { revision: number; homeId: string | null; homeGeneration: string | null; grants: ReadGrant[] };

export function HomeSettings() {
  const session = useQuery(sessionQuery);
  const query = homeQuery(session.data?.user.id ?? "");
  const state = useQuery(query);
  const client = useQueryClient();
  const [reset, setReset] = useState(0);
  const [notice, setNotice] = useState("");
  const update = useMutation({
    mutationFn: (body: Settings) => api<HomeState>("PUT", "/api/home", body),
    onSuccess: async (saved) => {
      await client.cancelQueries({ queryKey: query.queryKey });
      client.setQueryData(query.queryKey, saved);
      setReset((n) => n + 1);
      setNotice(saved.activeHome ? `${saved.activeHome.title} is now Home.` : "Built-in Home restored.");
    },
    onError: () => {
      setNotice("");
      void state.refetch();
    },
  });
  return (
    <main className="page home-settings">
      <h1>Home settings</h1>
      <p className="muted">Choose what opens when you visit Home and which app data it may read.</p>
      {notice ? (
        <p role="status">
          {notice} <Link to="/">Open Home</Link>
        </p>
      ) : null}
      {update.error ? (
        <Notice tone="danger" role="alert">
          {errorMessage(update.error)}
        </Notice>
      ) : null}
      {state.data ? (
        <SettingsForm
          key={reset}
          state={state.data}
          busy={update.isPending}
          onSave={(body) => {
            setNotice("");
            update.mutate(body);
          }}
          onRefresh={() => {
            update.reset();
            setReset((n) => n + 1);
          }}
        />
      ) : state.isError ? (
        <Notice tone="danger" role="alert">
          {errorMessage(state.error)}{" "}
          <button type="button" className="secondary" onClick={() => void state.refetch()}>
            Retry
          </button>
        </Notice>
      ) : (
        <p role="status">Loading settings…</p>
      )}
      <p>
        <Link to="/home/built-in">Open built-in Home</Link>
      </p>
    </main>
  );
}

function SettingsForm({
  state,
  busy,
  onSave,
  onRefresh,
}: {
  state: HomeState;
  busy: boolean;
  onSave: (body: Settings) => void;
  onRefresh: () => void;
}) {
  // The revision and bindings visible when editing began stay with this draft.
  const [baseline] = useState(state);
  const [id, setId] = useState(baseline.activeHome?.installationId ?? "");
  const [grants, setGrants] = useState<ReadGrant[]>(() =>
    baseline.activeHome
      ? baseline.grants.filter((grant) =>
          baseline.targets.some(
            (target) =>
              target.installationId === grant.installationId && target.bindingRevision === grant.bindingRevision,
          ),
        )
      : [],
  );
  const home = baseline.candidates.find((candidate) => candidate.installationId === id);
  const targets = baseline.targets.filter((target) => target.installationId !== id);
  const stale =
    baseline.revision !== state.revision ||
    JSON.stringify([baseline.candidates, baseline.targets]) !== JSON.stringify([state.candidates, state.targets]);

  function role(installationId: string, bindingRevision: number, roleId: string, checked: boolean) {
    setGrants((previous) => {
      const rest = previous.filter((grant) => grant.installationId !== installationId);
      const roles = new Set(previous.find((grant) => grant.installationId === installationId)?.roles);
      if (checked) roles.add(roleId);
      else roles.delete(roleId);
      return roles.size ? [...rest, { installationId, bindingRevision, roles: [...roles] }] : rest;
    });
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (!stale)
          onSave({
            revision: baseline.revision,
            homeId: home?.installationId ?? null,
            homeGeneration: home?.generation ?? null,
            grants: home ? grants : [],
          });
      }}
    >
      {baseline.selectedId && !baseline.activeHome ? (
        <Notice>
          The previously selected app is unavailable or changed. The built-in dashboard is open.
        </Notice>
      ) : null}
      <div className="card">
        <label>
          Home dashboard
          <select
            value={id}
            disabled={busy}
            onChange={(event) => {
              setId(event.target.value);
              setGrants([]);
            }}
          >
            <option value="">Built-in Home</option>
            {baseline.candidates.map((candidate) => (
              <option key={candidate.installationId} value={candidate.installationId}>
                {candidate.title}
              </option>
            ))}
          </select>
        </label>
        {!baseline.candidates.length ? (
          <p className="muted small">A running installed app that supports a workspace pane can appear here.</p>
        ) : null}
        {home ? (
          <p className="small">
            App address <code>{home.origin}</code>
          </p>
        ) : null}
      </div>
      {home ? (
        <section className="card">
          <h2>Read access for {home.title}</h2>
          <p className="muted">
            Select the roles this dashboard can use in other apps. Each role lists its allowed reads.
          </p>
          {!targets.length ? (
            <p>No connected apps currently offer an eligible read role.</p>
          ) : (
            targets.map((target) => (
              <fieldset key={target.installationId} disabled={busy}>
                <legend>{target.title}</legend>
                {Object.entries(target.roles).map(([roleId, definition]) => (
                  <label className="checkbox" key={roleId}>
                    <input
                      type="checkbox"
                      checked={grants.some(
                        (grant) => grant.installationId === target.installationId && grant.roles.includes(roleId),
                      )}
                      onChange={(event) =>
                        role(target.installationId, target.bindingRevision, roleId, event.target.checked)
                      }
                    />
                    {definition.title}
                    <small>{definition.routes.join(", ")}</small>
                  </label>
                ))}
              </fieldset>
            ))
          )}
        </section>
      ) : null}
      {stale ? (
        <Notice role="alert">
          The workspace changed during editing.{" "}
          <button type="button" className="secondary" onClick={onRefresh}>
            Reload settings
          </button>
        </Notice>
      ) : null}
      <div className="actions">
        <button type="submit" disabled={busy || stale}>
          {busy ? "Saving…" : "Save Home settings"}
        </button>
        {state.selectedId ? (
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => onSave({ revision: state.revision, homeId: null, homeGeneration: null, grants: [] })}
          >
            Restore built-in Home
          </button>
        ) : null}
      </div>
    </form>
  );
}
