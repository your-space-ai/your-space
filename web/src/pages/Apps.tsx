// Apps (journey 002, US3, US9, FR-011): the installed apps, data kept from removed ones, and
// installing an app from a link after reviewing what will run.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { api, appsQuery, errorMessage, shortDigest, STATE_LABEL, type AppList, type Review } from "../apps-api.ts";
import { JobProgress } from "../components/JobProgress.tsx";
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
          {list.apps.map((app) => (
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
                {app.hasInterface && app.publish?.link ? (
                  // Behind the owner's link, the app's settings point there, so it opens there in its own tab.
                  <a className="button" href={app.publish.link} target="_blank" rel="noreferrer" aria-label={`Open ${app.title}`}>
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
          ))}
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
                  <strong>{app.title}</strong> <span className="muted small">from {app.repo}</span>
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
  const [kit, setKit] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [reuse, setReuse] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [publish, setPublish] = useState<PublishForm>({ port: "", bind: "127.0.0.1", link: "" });
  const [installing, setInstalling] = useState<{ name: string; title: string; jobId: string; link: string | null } | null>(null);
  const [finished, setFinished] = useState<boolean | null>(null);

  const preview = useMutation({
    mutationFn: () => api<Review>("POST", "/api/apps/preview", { link, ...(kit.trim() ? { kit } : {}) }),
    onSuccess: (data) => {
      setReview(data);
      setValues({});
      setReuse(true);
      setPublishing(false);
      setPublish({ port: data.publishPort ? String(data.publishPort) : "", bind: "127.0.0.1", link: "" });
    },
  });

  const install = useMutation({
    mutationFn: (r: Review) =>
      api<{ name: string; jobId: string }>("POST", "/api/apps", {
        previewId: r.previewId,
        settings: Object.fromEntries(Object.entries(values).filter(([, v]) => v !== "")),
        reuseData: r.retained ? reuse : false,
        ...(publishing ? { publish: publishBody(publish) } : {}),
      }),
    onSuccess: (data, r) => {
      setInstalling({ name: data.name, title: r.title, jobId: data.jobId, link: publishing ? publishBody(publish).link : null });
      setFinished(null);
      setReview(null);
      setLink("");
      setKit("");
      void queryClient.invalidateQueries({ queryKey: ["apps"] });
    },
  });

  const onReview = (event: FormEvent) => {
    event.preventDefault();
    setReview(null);
    install.reset();
    preview.mutate();
  };

  return (
    <section aria-labelledby="install-heading" className="card">
      <h2 id="install-heading">Install an app</h2>
      <form onSubmit={onReview}>
        <label>
          Link to the app's Compose file
          <small>The file on GitHub, in a public repository, like https://github.com/owner/repo/blob/main/compose.yaml</small>
          <input type="url" required value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://github.com/…" />
        </label>
        <details>
          <summary>Advanced</summary>
          <label>
            Link to an installation kit
            <small>Only if you want a kit other than the one Your Space finds for this app.</small>
            <input type="url" value={kit} onChange={(e) => setKit(e.target.value)} placeholder="https://github.com/…" />
          </label>
        </details>
        <div>
          <button type="submit" disabled={preview.isPending}>
            {preview.isPending ? "Reading the file…" : "Review"}
          </button>
        </div>
      </form>
      {preview.isError ? (
        <p className="notice error" role="alert">
          {errorMessage(preview.error)}
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
              {installing.link ? (
                <a className="button" href={installing.link} target="_blank" rel="noreferrer">
                  Open {installing.title}
                </a>
              ) : (
                <Link className="button" to="/open/$name" params={{ name: installing.name }} search={{}}>
                  Open {installing.title}
                </Link>
              )}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
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
        {review.kit ? (
          <>
            , with its{" "}
            <a href={review.kit.source} target="_blank" rel="noreferrer">
              installation kit
            </a>
          </>
        ) : (
          ", without an installation kit"
        )}
        . It will be at <code>{(props.publishing && publishBody(props.publish).link) || review.origin}</code>.
      </p>

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
