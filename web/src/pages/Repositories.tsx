import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, appQuery, errorMessage } from "../apps-api.ts";
import { GitHubConnection } from "../components/GitHubConnection.tsx";
import { RepositoryDeployment } from "../components/RepositoryDeployment.tsx";
import { RepositoryFiles } from "../components/RepositoryFiles.tsx";
import { sessionQuery } from "../queries.ts";
import {
  connectionQuery,
  repositoryQuery,
  reposPath,
  type RepoCatalog,
  type Repository,
} from "../repositories-api.ts";
import { Install } from "./Apps.tsx";

export function Repositories({ appName }: { appName?: string }) {
  const session = useQuery(sessionQuery);
  const owner = session.data?.user.id ?? "";
  const connection = useQuery(connectionQuery(owner));
  const query = repositoryQuery(owner, connection.data?.login);
  const catalog = useQuery({ ...query, enabled: !!owner && connection.data?.connected === true });
  const app = useQuery({ ...appQuery(appName ?? ""), enabled: !!appName });
  const client = useQueryClient();
  const [selection, setSelection] = useState("");
  const data = connection.data?.connected ? catalog.data : undefined;
  const source = app.data && /^[\w.-]+\/[\w.-]+$/.test(app.data.source.repo) ? app.data.source.repo : "";
  const selected =
    data?.repos.find((r) => r.id === selection) ??
    (selection === "" ? data?.repos.find((r) => r.fullName === source) : undefined);
  const refresh = () => client.invalidateQueries({ queryKey: query.queryKey });
  return (
    <main className="page repo-page">
      <h1>Repositories</h1>
      <p className="muted">Manage GitHub source for your apps and review what runs in your workspace.</p>
      {appName ? (
        <div className="notice">
          {app.data ? (
            <>
              Customizing <strong>{app.data.title}</strong>.{" "}
              {source ? (
                <>
                  Installed source <code>{source}</code>.
                </>
              ) : (
                "Choose or create a repository for this installation."
              )}
            </>
          ) : app.error ? (
            errorMessage(app.error)
          ) : (
            "Loading installation…"
          )}
        </div>
      ) : null}
      <GitHubConnection ownerId={owner} />
      {connection.data?.connected && catalog.isError ? (
        <p className="notice error" role="alert">
          {errorMessage(catalog.error)}{" "}
          <button type="button" className="secondary" onClick={() => void catalog.refetch()}>
            Retry repositories
          </button>
        </p>
      ) : null}
      {data ? (
        <>
          <section className="card">
            <h2>Workspace repositories</h2>
            {data.repos.length ? (
              <label>
                Managed repository
                <select value={selected?.id ?? ""} onChange={(event) => setSelection(event.target.value)}>
                  <option value="">Choose a repository</option>
                  {data.repos.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.fullName} · {r.private ? "Private" : "Public"} · {r.origin}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <p>No repositories are managed by this workspace yet.</p>
            )}
            {connection.data?.connected ? (
              <RepoRegistration
                key={source + connection.data.scope}
                upstream={source}
                privateAccess={connection.data.scope === "repo"}
                onAdded={async (r) => {
                  await refresh();
                  setSelection(r.id);
                }}
              />
            ) : null}
          </section>
          {selected && connection.data?.connected ? (
            <RepoWork
              key={JSON.stringify([owner, connection.data.login, app.data?.id, selected.id])}
              accountScope={JSON.stringify([owner, connection.data.login])}
              repo={selected}
              appId={app.data?.id}
              composePath={app.data?.source.path}
            />
          ) : null}
          <RepoGrants data={data} refresh={refresh} />
        </>
      ) : connection.data?.connected && !catalog.error ? (
        <p role="status">Loading repositories…</p>
      ) : null}
    </main>
  );
}

function RepoRegistration({
  upstream,
  privateAccess,
  onAdded,
}: {
  upstream: string;
  privateAccess: boolean;
  onAdded: (repo: Repository) => Promise<void>;
}) {
  const [kind, setKind] = useState<"create" | "import" | "fork">(upstream ? "fork" : "create");
  const [name, setName] = useState("");
  const [fullName, setFullName] = useState(upstream);
  const [privateRepo, setPrivateRepo] = useState(privateAccess);
  const save = useMutation({
    mutationFn: () =>
      api<{ repo: Repository }>(
        "POST",
        reposPath + "/" + kind,
        kind === "create"
          ? { name: name.trim(), private: privateRepo && privateAccess }
          : { fullName: fullName.trim(), ...(kind === "fork" && name.trim() ? { name: name.trim() } : {}) },
      ),
    onSuccess: async ({ repo }) => {
      setName("");
      await onAdded(repo);
    },
  });
  return (
    <details className="repo-details" open={upstream ? true : undefined}>
      <summary>Add a repository</summary>
      <form
        className="repo-fields"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <label>
          Operation
          <select
            disabled={save.isPending}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value as typeof kind);
              save.reset();
            }}
          >
            <option value="create">Create a repository</option>
            <option value="import">Import an existing repository</option>
            <option value="fork">Fork a repository</option>
          </select>
        </label>
        {kind !== "create" ? (
          <label>
            GitHub owner/repository
            <input
              required
              value={fullName}
              placeholder="owner/project"
              onChange={(e) => setFullName(e.target.value)}
            />
          </label>
        ) : null}
        {kind !== "import" ? (
          <label>
            {kind === "fork" ? "Fork name (optional)" : "Repository name"}
            <input value={name} required={kind === "create"} onChange={(e) => setName(e.target.value)} />
          </label>
        ) : null}
        {kind === "create" ? (
          <label>
            Visibility
            <select
              value={privateRepo && privateAccess ? "private" : "public"}
              onChange={(e) => setPrivateRepo(e.target.value === "private")}
            >
              {privateAccess ? <option value="private">Private</option> : null}
              <option value="public">Public</option>
            </select>
          </label>
        ) : null}
        <p className="small muted">
          {kind === "create"
            ? privateRepo && privateAccess
              ? "GitHub will create a private repository in your account."
              : "GitHub will create a public repository anyone can read."
            : kind === "fork"
              ? "GitHub will fork the source into your account using its visibility."
              : "Adds this repository to the workspace’s managed list."}
        </p>
        <button type="submit" disabled={save.isPending}>
          {kind === "create" ? "Create repository" : kind === "fork" ? "Fork repository" : "Import repository"}
        </button>
      </form>
      {save.error ? (
        <p className="notice error" role="alert">
          {errorMessage(save.error)}
        </p>
      ) : null}
      {save.data ? <p role="status">{save.data.repo.fullName} is in this workspace.</p> : null}
    </details>
  );
}

function RepoWork({
  repo,
  appId,
  composePath,
  accountScope,
}: {
  repo: Repository;
  appId?: string;
  composePath?: string;
  accountScope: string;
}) {
  const [mode, setMode] = useState<"files" | "install" | "deploy">(appId ? "deploy" : "files");
  return (
    <section>
      <h2>{repo.fullName}</h2>
      <div className="actions repo-operations" aria-label="Repository operations">
        {(["files", "install", "deploy"] as const).map((item) => (
          <button
            type="button"
            key={item}
            aria-pressed={mode === item}
            className={mode === item ? "" : "secondary"}
            onClick={() => setMode(item)}
          >
            {{ files: "Edit files", install: "Install new app", deploy: "Update installed app" }[item]}
          </button>
        ))}
      </div>
      {mode === "files" ? (
        <RepositoryFiles repo={repo} />
      ) : mode === "install" ? (
        <Install repository={repo} />
      ) : (
        <RepositoryDeployment accountScope={accountScope} repo={repo} initialAppId={appId} initialPath={composePath} />
      )}
    </section>
  );
}

function RepoGrants({ data, refresh }: { data: RepoCatalog; refresh: () => Promise<void> }) {
  const [agent, setAgent] = useState("");
  const selected = data.agents.find((item) => item.id === agent);
  return (
    <section className="card">
      <h2>Agent repository access</h2>
      {!data.agents.length ? (
        <p>Create an agent identity to grant repository access.</p>
      ) : (
        <>
          <label>
            Agent identity
            <select value={agent} onChange={(event) => setAgent(event.target.value)}>
              <option value="">Choose an agent</option>
              {data.agents.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          {selected ? <GrantForm key={agent} data={data} agent={selected} refresh={refresh} /> : null}
        </>
      )}
    </section>
  );
}

function GrantForm({
  data,
  agent,
  refresh,
}: {
  data: RepoCatalog;
  agent: { id: string; name: string };
  refresh: () => Promise<void>;
}) {
  const current = data.grants.find((g) => g.agentId === agent.id);
  const [base, setBase] = useState(current?.revision ?? 0);
  const [create, setCreate] = useState(!!current?.canCreate);
  const [fork, setFork] = useState(!!current?.canFork);
  const [ids, setIds] = useState<string[]>(current?.repoIds ?? []);
  const changed = base !== (current?.revision ?? 0);
  const save = useMutation({
    mutationFn: () =>
      api("PUT", reposPath + "/grants/" + agent.id, {
        revision: base,
        canCreate: create,
        canFork: fork,
        repoIds: ids,
      }),
    onSuccess: async () => {
      await refresh();
      setBase(base + 1);
    },
    onError: () => {
      void refresh();
    },
  });
  function reload() {
    setBase(current?.revision ?? 0);
    setCreate(!!current?.canCreate);
    setFork(!!current?.canFork);
    setIds(current?.repoIds ?? []);
    save.reset();
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!changed) save.mutate();
      }}
    >
      <fieldset disabled={save.isPending}>
        <legend>{agent.name}</legend>
        <label className="checkbox">
          <input type="checkbox" checked={create} onChange={(e) => setCreate(e.target.checked)} /> Create repositories
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={fork} onChange={(e) => setFork(e.target.checked)} /> Fork repositories
        </label>
        <p>Read and commit to these managed repositories</p>
        {data.repos.map((r) => (
          <label className="checkbox" key={r.id}>
            <input
              type="checkbox"
              checked={ids.includes(r.id)}
              onChange={(e) => setIds(e.target.checked ? [...ids, r.id] : ids.filter((id) => id !== r.id))}
            />
            {r.fullName}
          </label>
        ))}
      </fieldset>
      {save.error ? (
        <p className="notice error" role="alert">
          {errorMessage(save.error)}
        </p>
      ) : null}
      {changed ? (
        <p className="notice">
          The grant changed.{" "}
          <button type="button" className="secondary" onClick={reload}>
            Reload grant
          </button>
        </p>
      ) : null}
      <div>
        <button type="submit" disabled={save.isPending || changed}>
          Save repository access
        </button>
      </div>
      {save.isSuccess ? <p role="status">Repository access saved.</p> : null}
    </form>
  );
}
