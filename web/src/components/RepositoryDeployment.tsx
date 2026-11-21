import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { api, appsQuery, errorMessage } from "../apps-api.ts";
import { reposPath, type Repository } from "../repositories-api.ts";

type Plan = {
  previewId: string;
  appId: string;
  repoId: string;
  repo: string;
  commit: string;
  previousCommit: string;
  images: Record<string, { digest: string }>;
  services: string[];
  volumes?: string[];
};
export function RepositoryDeployment({
  repo,
  initialAppId,
  initialPath,
}: {
  repo: Repository;
  initialAppId?: string;
  initialPath?: string;
}) {
  const apps = useQuery(appsQuery);
  const client = useQueryClient();
  const [appId, setAppId] = useState(initialAppId ?? "");
  const [ref, setRef] = useState(repo.defaultBranch);
  const [composePath, setComposePath] = useState(initialPath || "compose.yaml");
  const [kit, setKit] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [receipt, setReceipt] = useState<{ status: string; commit: string } | null>(null);
  const selected = apps.data?.apps.find((app) => app.id === appId);
  const preview = useMutation({
    mutationFn: () =>
      api<Plan>("POST", `${reposPath}/${repo.id}/deploy/preview`, {
        appId,
        ref: ref.trim(),
        composePath: composePath.trim(),
        ...(kit.trim() ? { kitPath: kit.trim() } : {}),
      }),
    onSuccess: setPlan,
  });
  const apply = useMutation({
    mutationFn: (authorized: Plan) =>
      api<{ status: string; commit: string }>("POST", `${reposPath}/${repo.id}/deploy/apply`, {
        appId: authorized.appId,
        previewId: authorized.previewId,
      }),
    onSuccess: async (done) => {
      setReceipt(done);
      setPlan(null);
      await client.invalidateQueries({ queryKey: ["apps"] });
    },
  });
  const busy = preview.isPending || apply.isPending;
  function clear() {
    setPlan(null);
    setReceipt(null);
    preview.reset();
    apply.reset();
  }
  return (
    <section className="card">
      <h2>Update an installed app</h2>
      <p className="muted">Review the pinned commit for an existing installation before applying it.</p>
      {apps.error ? (
        <p className="notice error" role="alert">
          {errorMessage(apps.error)}
        </p>
      ) : null}
      <form
        className="repo-fields"
        onSubmit={(event) => {
          event.preventDefault();
          clear();
          preview.mutate();
        }}
      >
        <label>
          Installed app
          <select
            required
            disabled={busy}
            value={appId}
            onChange={(e) => {
              clear();
              setAppId(e.target.value);
            }}
          >
            <option value="">Choose an installed app</option>
            {apps.data?.apps.map((app) => (
              <option key={app.id} value={app.id}>
                {app.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          Branch, tag, or commit
          <input
            required
            disabled={busy}
            value={ref}
            onChange={(e) => {
              clear();
              setRef(e.target.value);
            }}
          />
        </label>
        <label>
          Compose file path
          <input
            required
            disabled={busy}
            value={composePath}
            onChange={(e) => {
              clear();
              setComposePath(e.target.value);
            }}
          />
        </label>
        <label>
          Kit file path (optional)
          <input
            disabled={busy}
            value={kit}
            onChange={(e) => {
              clear();
              setKit(e.target.value);
            }}
          />
        </label>
        <button
          type="submit"
          className="secondary"
          disabled={busy || !selected || !ref.trim() || !composePath.trim()}
        >
          Review deployment
        </button>
      </form>
      {preview.error || apply.error ? (
        <p className="notice error" role="alert">
          {errorMessage(preview.error ?? apply.error)}
        </p>
      ) : null}
      {plan && selected && plan.appId === selected.id && plan.repoId === repo.id ? (
        <section className="deploy-review">
          <h3>Deploy to {selected.title}</h3>
          <dl>
            <dt>Source</dt>
            <dd>{plan.repo}</dd>
            <dt>Installed revision</dt>
            <dd>
              <code>{plan.previousCommit}</code>
            </dd>
            <dt>New commit</dt>
            <dd>
              <code>{plan.commit}</code>
            </dd>
            <dt>Services</dt>
            <dd>{plan.services.join(", ")}</dd>
          </dl>
          {Object.entries(plan.images).length ? (
            <ul>
              {Object.entries(plan.images).map(([name, image]) => (
                <li key={name}>
                  {name} <code>{image.digest}</code>
                </li>
              ))}
            </ul>
          ) : null}
          {plan.volumes?.length ? (
            <p>
              Existing volumes <code>{plan.volumes.join(", ")}</code>
            </p>
          ) : null}
          <p>
            The reviewed version keeps the existing volume layout. A source change may clear app credentials and
            role grants. Reconnect and regrant access after applying if needed.
          </p>
          <div className="actions">
            <button type="button" disabled={busy} onClick={() => apply.mutate(plan)}>
              {apply.isPending ? "Applying…" : "Apply reviewed deployment"}
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={clear}>
              Cancel review
            </button>
          </div>
        </section>
      ) : null}
      {receipt ? (
        <p role="status">
          Deployment {receipt.status} for <code>{receipt.commit}</code>.{" "}
          {selected ? (
            <Link to="/apps/$name" params={{ name: selected.name }}>
              View installation
            </Link>
          ) : null}
        </p>
      ) : null}
    </section>
  );
}
