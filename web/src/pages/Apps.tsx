// Apps (journey 002, US3, US9, FR-011): the installed apps, data kept from removed ones, and
// installing an app from the link to its kit after reviewing what will run (decision 2026-11-23).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { api, ApiError, appsQuery, errorMessage, ownTabLink, shortDigest, STATE_LABEL, type AppList, type FileRead, type Review } from "../apps-api.ts";
import { JobProgress } from "../components/JobProgress.tsx";
import { KnowledgePicker } from "../components/KnowledgePicker.tsx";
import { PUBLISH_NOTE, publishBody, PublishFields, type PublishForm } from "../components/PublishFields.tsx";
import { DeleteData } from "./AppDetail.tsx";

export function Apps() {
  const apps = useQuery(appsQuery);

  return (
    <main className="page" data-state="apps">
      <h1>Apps</h1>
      {apps.isError ? (
        <p className="notice error" role="alert">
          {errorMessage(apps.error)}
        </p>
      ) : null}
      {apps.isPending ? <p className="muted">Loading…</p> : null}
      {apps.data ? <AppTable list={apps.data} /> : null}
      <Install />
    </main>
  );
}

function AppTable({ list }: { list: AppList }) {
  return (
    <>
      {list.apps.length === 0 ? (
        <p className="muted">No app is installed yet.</p>
      ) : (
        <ul className="app-list" aria-label="Installed apps">
          {list.apps.map((app) => {
            const ownTab = ownTabLink(app);
            return (
              <li key={app.name} data-app={app.name} data-app-state={app.state}>
                <div>
                  <strong>{app.title}</strong> <span className={`state state-${app.state}`}>{STATE_LABEL[app.state]}</span>
                  {app.pendingRequests > 0 ? (
                    <span className="badge" title="Access requests waiting">
                      {app.pendingRequests} access request{app.pendingRequests === 1 ? "" : "s"}
                    </span>
                  ) : null}
                  {app.stateReason ? <div className="muted small">{app.stateReason}</div> : null}
                </div>
                <div className="actions">
                  {app.hasInterface && ownTab ? (
                    // Not shown inside Your Space, the app opens at the owner's link in its own tab.
                    <a className="button" href={ownTab} target="_blank" rel="noreferrer" aria-label={`Open ${app.title}`}>
                      Open
                    </a>
                  ) : app.hasInterface ? (
                    <Link className="button" to="/open/$name" params={{ name: app.name }} search={{}} aria-label={`Open ${app.title}`}>
                      Open
                    </Link>
                  ) : null}
                  <Link className="button secondary-link" to="/apps/$name" params={{ name: app.name }} aria-label={`Details of ${app.title}`}>
                    Details
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {list.retained.length > 0 ? (
        <section aria-labelledby="retained-heading">
          <h2 id="retained-heading">Kept data</h2>
          <p className="muted">These apps were removed. Their data is kept until you delete it, and installing the same app again can reuse it.</p>
          <ul className="app-list" aria-label="Kept data">
            {list.retained.map((app) => (
              <li key={app.name} data-retained={app.name}>
                <div>
                  <strong>{app.title}</strong> <span className="muted small">from {app.repo || "this machine"}</span>
                </div>
                <DeleteData name={app.name} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function Install() {
  const queryClient = useQueryClient();
  const [link, setLink] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [reuse, setReuse] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [publish, setPublish] = useState<PublishForm>({ port: "", bind: "127.0.0.1", link: "" });
  const [knowledge, setKnowledge] = useState<string[]>([]);
  const [installing, setInstalling] = useState<{ name: string; title: string; jobId: string } | null>(null);
  const [finished, setFinished] = useState<boolean | null>(null);

  // Every app installs with a kit: from its link, or a kit in the directory.
  const preview = useMutation({
    mutationFn: (kitUrl: string) => api<Review>("POST", "/api/kits/preview", { kitUrl: kitUrl.trim() }),
    onSuccess: (data) => {
      setReview(data);
      setValues({});
      setReuse(true);
      setPublishing(false);
      setPublish({ port: data.publishPort ? String(data.publishPort) : "", bind: "127.0.0.1", link: "" });
      setKnowledge([]);
    },
  });

  const install = useMutation({
    mutationFn: (r: Review) =>
      api<{ name: string; jobId: string }>("POST", "/api/apps", {
        previewId: r.previewId,
        settings: Object.fromEntries(Object.entries(values).filter(([, v]) => v !== "")),
        reuseData: r.retained ? reuse : false,
        ...(publishing ? { publish: publishBody(publish) } : {}),
        ...(r.knowledge ? { knowledge } : {}),
      }),
    onSuccess: (data, r) => {
      setInstalling({ name: data.name, title: r.title, jobId: data.jobId });
      setFinished(null);
      setReview(null);
      setLink("");
      void queryClient.invalidateQueries({ queryKey: ["apps"] });
    },
  });

  const reviewKit = (kitUrl: string) => {
    setReview(null);
    install.reset();
    preview.mutate(kitUrl);
  };
  const onReview = (event: FormEvent) => {
    event.preventDefault();
    reviewKit(link);
  };

  return (
    <section aria-labelledby="install-heading" className="card">
      <h2 id="install-heading">Install an app</h2>
      <form onSubmit={onReview}>
        <label>
          Link to the app's kit
          <small>
            A kit is a small file that names the app's Compose file at an exact commit and says what Your Space needs to run and show the app.
            Your Space installs apps from their kits. Paste the kit's GitHub link, like https://github.com/owner/repo/blob/main/kit.yaml
          </small>
          <input type="url" required value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://github.com/…" />
        </label>
        <div>
          <button type="submit" disabled={preview.isPending || install.isPending}>
            {preview.isPending ? "Reading the kit…" : "Review"}
          </button>
        </div>
      </form>
      {preview.isError ? (
        <p className="notice error" role="alert">
          {errorMessage(preview.error)}
          {preview.error instanceof ApiError && CONNECTION_FIX[preview.error.code] ? (
            <>
              {" "}
              <Link to="/github">{CONNECTION_FIX[preview.error.code]}</Link>
            </>
          ) : null}
        </p>
      ) : null}
      {review ? (
        <ReviewPanel
          review={review}
          values={values}
          setValue={(name, value) => setValues((v) => ({ ...v, [name]: value }))}
          reuse={reuse}
          setReuse={setReuse}
          publishing={publishing}
          setPublishing={setPublishing}
          publish={publish}
          setPublish={setPublish}
          knowledge={knowledge}
          setKnowledge={setKnowledge}
          onInstall={() => install.mutate(review)}
          onCancel={() => setReview(null)}
          installing={install.isPending}
          error={install.isError ? errorMessage(install.error) : null}
        />
      ) : null}
      {installing ? (
        <>
          <JobProgress jobId={installing.jobId} title={`Installing ${installing.title}`} onDone={setFinished} />
          {finished ? (
            <p>
              {/* Its pane shows it, or says why it opens in its own tab. */}
              <Link className="button" to="/open/$name" params={{ name: installing.name }} search={{}}>
                Open {installing.title}
              </Link>
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

/** Where the owner fixes a review the GitHub connection answers (journey 015): the GitHub page. */
const CONNECTION_FIX: Record<string, string> = {
  not_connected: "Connect GitHub",
  token_refused: "Reconnect GitHub",
  token_unreadable: "Reconnect GitHub",
  repository_not_visible: "Open the GitHub page",
};

/** A Private label on a file read through the GitHub connection (decision 7). */
function PrivateLabel({ read, file }: { read: FileRead | null; file: string }) {
  if (read?.read !== "connection") return null;
  return (
    <>
      {" "}
      <span className="source-label" data-private={file}>
        Private · read with your GitHub connection (@{read.login})
      </span>
    </>
  );
}

/** The image reference the review's versions are keyed by: with a tag, without a digest. */
function imageRef(image: string): string {
  const base = image.split("@")[0]!;
  return base.slice(base.lastIndexOf("/") + 1).includes(":") ? base : `${base}:latest`;
}

const KIND_LABEL = { changed: "Changed", left_out: "Left out", added: "Added" } as const;

function ReviewPanel(props: {
  review: Review;
  values: Record<string, string>;
  setValue: (name: string, value: string) => void;
  reuse: boolean;
  setReuse: (value: boolean) => void;
  publishing: boolean;
  setPublishing: (value: boolean) => void;
  publish: PublishForm;
  setPublish: (form: PublishForm) => void;
  knowledge: string[];
  setKnowledge: (names: string[]) => void;
  onInstall: () => void;
  onCancel: () => void;
  installing: boolean;
  error: string | null;
}) {
  const { review } = props;
  const editable = review.settings.filter((s) => !s.derived && !s.generated && (s.required || !s.set));
  const missing = review.settings.filter((s) => s.required && !s.set && !props.values[s.name]);
  const digests = new Map(review.images.map((i) => [i.ref, i]));

  return (
    <section aria-labelledby="review-heading" className="review" data-review={review.name}>
      <h2 id="review-heading">Review</h2>
      <p>
        <strong>{review.title}</strong> from{" "}
        <a href={review.source.pinnedLink} target="_blank" rel="noreferrer">
          {review.source.repo}/{review.source.path}
        </a>{" "}
        at commit <code>{review.source.commit.slice(0, 12)}</code>
        <PrivateLabel read={review.source.read} file="compose" />, with its kit
        {review.kit.repo && review.kit.commit ? (
          <>
            {" "}
            <a href={review.kit.source} target="_blank" rel="noreferrer">
              {review.kit.repo}/{review.kit.path}
            </a>{" "}
            at commit <code>{review.kit.commit.slice(0, 12)}</code>
            <PrivateLabel read={review.kit.read} file="kit" />
          </>
        ) : null}
        . It will be at <code>{(props.publishing && publishBody(props.publish).link) || review.origin}</code>.
      </p>
      {review.readsRepository ? (
        <p data-field="reads-repository">
          This kit reads <code>{review.readsRepository}</code> with your GitHub connection.
        </p>
      ) : null}

      {review.refusals.length > 0 ? (
        <div className="notice error" role="alert">
          <p>Your Space can't run this app as it is:</p>
          <ul aria-label="Refusals">
            {review.refusals.map((r, i) => (
              <li key={i}>
                {r.service ? <strong>{r.service}: </strong> : null}
                {r.reason}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <h3>What will run</h3>
      <table>
        <thead>
          <tr>
            <th scope="col">Service</th>
            <th scope="col">Image</th>
            <th scope="col">Version</th>
          </tr>
        </thead>
        <tbody>
          {review.services.map((s) => {
            const image = digests.get(imageRef(s.image));
            return (
              <tr key={s.name}>
                <td>
                  {s.name}
                  {s.interface ? <span className="muted small"> (interface)</span> : null}
                </td>
                <td>
                  <code>{s.image}</code>
                  {image?.private ? (
                    <>
                      {" "}
                      <span className="source-label" data-private="image">
                        Private image
                      </span>
                    </>
                  ) : null}
                </td>
                <td>
                  <code title={image?.digest}>{shortDigest(image?.digest)}</code>
                  {image && !image.runsHere ? <span className="error small"> not for this processor</span> : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {review.adaptations.length > 0 ? (
        <>
          <h3>What Your Space changes</h3>
          <ul aria-label="Changes">
            {review.adaptations.map((a, i) => (
              <li key={i} data-kind={a.kind}>
                <span className={`kind kind-${a.kind}`}>{KIND_LABEL[a.kind]}</span> <strong>{a.service}</strong>: {a.detail}
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {review.settings.length > 0 ? (
        <>
          <h3>Settings</h3>
          <ul aria-label="Review settings" className="settings-summary">
            {review.settings
              .filter((s) => s.generated || s.derived || s.secret)
              .map((s) => (
                <li key={s.name}>
                  <code>{s.name}</code>:{" "}
                  {s.generated ? "generated by Your Space" : s.derived ? (s.secret ? "worked out by Your Space" : `set to ${s.value ?? "the app's address"}`) : s.set ? "set" : "not set"}
                </li>
              ))}
          </ul>
          {editable.length > 0 ? (
            <details open={missing.length > 0}>
              <summary>Set values now ({editable.length})</summary>
              <div className="fields">
                {editable.map((s) => (
                  <label key={s.name}>
                    {s.name}
                    {s.required ? <small>Required</small> : s.publishedDefault ? <small>Default: {s.publishedDefault}</small> : null}
                    <input
                      type={s.secret ? "password" : "text"}
                      autoComplete="off"
                      required={s.required}
                      value={props.values[s.name] ?? ""}
                      onChange={(e) => props.setValue(s.name, e.target.value)}
                    />
                  </label>
                ))}
              </div>
            </details>
          ) : null}
        </>
      ) : null}

      <h3>Internet access</h3>
      {review.outbound.length > 0 ? (
        <>
          <p>Installing approves these hosts, which the app needs to work. It asks you before reaching any other.</p>
          <ul aria-label="Starter hosts">
            {review.outbound.map((h) => (
              <li key={h}>
                <code>{h}</code>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p>The app starts with no internet access. It asks you when it needs a host.</p>
      )}

      {review.knowledge ? (
        <section aria-labelledby="review-knowledge-heading">
          <h3 id="review-knowledge-heading">Knowledge</h3>
          <p>
            {review.title} asks for knowledge bases. Each one you give it is a folder it can read and write, in{" "}
            <code>{review.knowledge.path}</code>. You can change them later on its page.
          </p>
          <KnowledgePicker path={review.knowledge.path} selected={props.knowledge} onChange={props.setKnowledge} />
        </section>
      ) : null}

      {review.interface ? (
        <>
          <h3>Publishing</h3>
          <label className="checkbox">
            <input type="checkbox" checked={props.publishing} onChange={(e) => props.setPublishing(e.target.checked)} />
            Publish on a port of this machine
            <small>{PUBLISH_NOTE}</small>
          </label>
          {props.publishing ? <PublishFields form={props.publish} onChange={props.setPublish} defaultPort={review.publishPort} /> : null}
        </>
      ) : null}

      {review.retained ? (
        <label className="checkbox">
          <input type="checkbox" checked={props.reuse} onChange={(e) => props.setReuse(e.target.checked)} />
          Reuse kept data
          <small>Data kept from when {review.title} was removed. Without it, delete the kept data first.</small>
        </label>
      ) : null}

      <p className="notice warning" role="note">
        {review.warning}
      </p>
      {props.error ? (
        <p className="notice error" role="alert">
          {props.error}
        </p>
      ) : null}
      <div className="actions">
        <button type="button" onClick={props.onInstall} disabled={!review.ok || props.installing || missing.length > 0 || (review.retained && !props.reuse)}>
          {props.installing ? "Installing…" : "Install"}
        </button>
        <button type="button" className="secondary" onClick={props.onCancel}>
          Cancel
        </button>
      </div>
    </section>
  );
}
