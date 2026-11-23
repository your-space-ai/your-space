import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { api, ApiError, appsQuery, errorMessage } from "../apps-api.ts";
import { failureKind } from "../errors.ts";
import { reposPath, type Repository } from "../repositories-api.ts";
import { Notice } from "../ui/index.ts";

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
type Receipt = { status: "applied"; appId: string; repoId: string; commit: string };
function matchesReceipt(receipt: Receipt | null | undefined, plan: Plan): receipt is Receipt {
  return receipt?.status === "applied" && receipt.appId === plan.appId &&
    receipt.repoId === plan.repoId && receipt.commit === plan.commit;
}

export function RepositoryDeployment({
  repo,
  accountScope,
  initialAppId,
  initialPath,
}: {
  repo: Repository;
  accountScope: string;
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
  const [checkingReceipt, setCheckingReceipt] = useState(false);
  const [receipt, setReceipt] = useState<{ status: string; commit: string } | null>(null);
  const selected = apps.data?.apps.find((app) => app.id === appId);
  const pendingKey = ["repository-deployment", accountScope, repo.id, appId];
  const pending = useQuery({
    queryKey: pendingKey,
    enabled: !!appId,
    queryFn: () =>
      api<{ pending: Plan | null }>("GET", `${reposPath}/${repo.id}/deploy/pending?appId=${encodeURIComponent(appId)}`),
    retry: false,
  });
  const interrupted = pending.data?.pending;
  const reviewed = interrupted ?? plan;
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
    mutationFn: async (authorized: Plan) => {
      const { appId, previewId, commit, repoId } = authorized;
      const deployment = `${reposPath}/${repoId}/deploy`;
      try {
        const done = await api<Receipt>("POST", `${deployment}/apply`, { appId, previewId, commit });
        if (matchesReceipt(done, authorized)) return done;
      } catch (error) {
        if (failureKind(error) !== "server_unreachable") throw error;
      }

      // The application may have been replaced even if the response was missing or incomplete.
      // Only a receipt for this owner's reviewed deployment can confirm success.
      setCheckingReceipt(true);
      const query = new URLSearchParams({ appId, previewId, commit });
      let applying = false;
      // Allow the initial request to reach the server. Keep checking for up to a minute only
      // while the server has observed this exact replacement applying.
      for (let attempt = 0; attempt < 30; attempt++) {
        if (attempt) await new Promise((resolve) => setTimeout(resolve, 2000));
        try {
          const result = await api<{ receipt: Receipt | null; applying?: boolean }>("GET", `${deployment}/receipt?${query}`);
          if (matchesReceipt(result?.receipt, authorized)) return result.receipt;
          applying = result?.applying === true;
        } catch (readError) {
          if (failureKind(readError) !== "server_unreachable") throw readError;
        }
        if (!applying && attempt > 0) break;
      }
      throw new ApiError(0, "deployment_unconfirmed", "Your Space couldn't confirm the deployment. Check the installation status before trying again.");
    },
    onSettled: () => setCheckingReceipt(false),
    onSuccess: async (done) => {
      // The receipt answers the check, so stop showing it now rather than after the refetch below.
      setCheckingReceipt(false);
      setReceipt(done);
      setPlan(null);
      client.setQueryData(pendingKey, { pending: null });
      await client.invalidateQueries({ queryKey: ["apps"] });
    },
    onError: () => {
      void pending.refetch();
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
        <Notice tone="danger" role="alert">
          {errorMessage(apps.error)}
        </Notice>
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
          disabled={busy || !selected || !pending.isSuccess || !!interrupted || !ref.trim() || !composePath.trim()}
        >
          Review deployment
        </button>
      </form>
      {pending.isError ? (
        <p role="alert">
          Couldn’t check this installation for an interrupted deployment.{" "}
          <button type="button" onClick={() => void pending.refetch()}>
            Retry check
          </button>
        </p>
      ) : null}
      {checkingReceipt ? <p role="status">Checking whether the reviewed deployment finished…</p> : null}
      {preview.error || apply.error ? (
        <Notice tone="danger" role="alert">
          {errorMessage(preview.error ?? apply.error)}
          {apply.error instanceof ApiError && apply.error.code === "deployment_unconfirmed" && selected ? (
            <> <Link to="/apps/$name" params={{ name: selected.name }}>Check installation status</Link></>
          ) : null}
        </Notice>
      ) : null}
      {reviewed && selected && reviewed.appId === selected.id && reviewed.repoId === repo.id ? (
        <section className="deploy-review">
          <h3>
            {interrupted ? "Resume deployment to " : "Deploy to "}
            {selected.title}
          </h3>
          {interrupted ? <p>The previous attempt was interrupted. Confirm the pinned commit below to resume.</p> : null}
          <dl>
            <dt>Source</dt>
            <dd>{reviewed.repo}</dd>
            <dt>Installed revision</dt>
            <dd>
              <code>{reviewed.previousCommit}</code>
            </dd>
            <dt>New commit</dt>
            <dd>
              <code>{reviewed.commit}</code>
            </dd>
            <dt>Services</dt>
            <dd>{reviewed.services.join(", ")}</dd>
          </dl>
          {Object.entries(reviewed.images).length ? (
            <ul>
              {Object.entries(reviewed.images).map(([name, image]) => (
                <li key={name}>
                  {name} <code>{image.digest}</code>
                </li>
              ))}
            </ul>
          ) : null}
          {reviewed.volumes?.length ? (
            <p>
              Existing volumes <code>{reviewed.volumes.join(", ")}</code>
            </p>
          ) : null}
          <p>
            The reviewed version keeps the existing volume layout. A source change may clear app credentials and role
            grants. Reconnect and regrant access after applying if needed.
          </p>
          <div className="actions">
            <button type="button" disabled={busy} onClick={() => apply.mutate(reviewed)}>
              {apply.isPending ? "Applying…" : interrupted ? "Resume reviewed deployment" : "Apply reviewed deployment"}
            </button>
            {!interrupted ? (
              <button type="button" className="secondary" disabled={busy} onClick={clear}>
                Cancel review
              </button>
            ) : null}
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
