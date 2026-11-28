// Journey 019: an installed app's update, inside its status card (decision 2, design A). Opening the
// page checks the app's kit at most every 12 hours; Check for update checks at once (decision 4). An
// update shows as "Update available" on the kit's row, and Preview changes opens, in the same card,
// what it changes in plain sentences, the settings it adds to fill in, and the diff on GitHub.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { api, errorMessage, type AppDetail, type UpdateChanges, type UpdateReview } from "../apps-api.ts";

type Mark = "add" | "del" | "chg";
const SIGN: Record<Mark, string> = { add: "+", del: "−", chg: "↻" };

/** What an update changes, one plain sentence each, marked as added, removed or changed. */
export function describeChanges(changes: UpdateChanges): { mark: Mark; text: ReactNode }[] {
  const lines: { mark: Mark; text: ReactNode }[] = [];
  const line = (mark: Mark, text: ReactNode) => lines.push({ mark, text });
  if (changes.compose) {
    const { from, to } = changes.compose;
    line(
      "chg",
      from.repo !== to.repo || from.path !== to.path ? (
        <>
          Its Compose file moves from <code>{`${from.repo}/${from.path}`}</code> to <code>{`${to.repo}/${to.path}`}</code>.
        </>
      ) : (
        <>Its Compose file moves to a newer commit.</>
      ),
    );
  }
  for (const image of changes.images) {
    const ref = <code>{image.ref}</code>;
    if (image.from === null) line("add", <>It uses {image.private ? "the private image" : "the image"} {ref}.</>);
    else if (image.to === null) line("del", <>It no longer uses the image {ref}.</>);
    else line("chg", <>The app's {image.private ? "private image" : "image"} {ref} moves to a new version.</>);
  }
  for (const name of changes.settings.added) line("add", <>A new setting, <code>{name}</code>.</>);
  for (const name of changes.settings.removed) line("del", <>The setting <code>{name}</code> is no longer used, and is removed.</>);
  for (const name of changes.settings.changed) line("chg", <>The setting <code>{name}</code> takes the kit's new value.</>);
  for (const host of changes.outbound.added) line("add", <>The app may reach <code>{host}</code>.</>);
  for (const host of changes.outbound.removed) line("del", <>The app no longer reaches <code>{host}</code>.</>);
  for (const service of changes.services.added) line("add", <>A new service, <code>{service}</code>.</>);
  for (const service of changes.services.removed) line("del", <>The service <code>{service}</code> is removed.</>);
  if (changes.interface) {
    const to = changes.interface.to;
    line("chg", to ? <>Your Space opens it at <code>{`${to.service}:${to.port}`}</code>.</> : <>It no longer has an interface to open.</>);
  }
  return lines;
}

/** The kit's repository and commit, from its pinned link. */
function pinned(link: string | null | undefined): { repo: string; commit: string } | null {
  const found = link ? /^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/([0-9a-f]{40})\//.exec(link) : null;
  return found ? { repo: found[1]!, commit: found[2]! } : null;
}

/** The update state the status card shows: the label on the kit's row, and the panel under it. */
export function useKitUpdate(d: AppDetail) {
  const queryClient = useQueryClient();
  const fromGithub = Boolean(d.kitSource?.startsWith("https://"));
  const [review, setReview] = useState<UpdateReview | null>(null);
  const [open, setOpen] = useState(false);
  // Opening the page checks the app at most every 12 hours; the server says when it didn't.
  const auto = useQuery({
    queryKey: ["apps", d.name, "update-check"],
    queryFn: () => api<UpdateReview | { skipped: true }>("POST", `/api/apps/${d.name}/update/check`, { auto: true }),
    enabled: fromGithub && d.state !== "removed",
    staleTime: Infinity,
    retry: false,
  });
  const check = useMutation({
    mutationFn: () => api<UpdateReview>("POST", `/api/apps/${d.name}/update/check`, {}),
    onSuccess: (r) => {
      setReview(r);
      void queryClient.invalidateQueries({ queryKey: ["apps", d.name], exact: true });
    },
  });
  const found = review ?? (auto.data && !("skipped" in auto.data) ? auto.data : null);
  const available = found ? !found.upToDate : d.update?.available === true;
  return { fromGithub, found, available, open, setOpen, check, setReview, autoError: auto.error };
}

export function UpdateLabel({ available }: { available: boolean }) {
  return available ? (
    <span className="update-pill" data-field="update-available">
      Update available
    </span>
  ) : null;
}

export function KitUpdatePanel({ detail: d, state, onStarted }: { detail: AppDetail; state: ReturnType<typeof useKitUpdate>; onStarted: (r: { jobId: string }) => void }) {
  const queryClient = useQueryClient();
  const { found, available, open, setOpen, check, setReview } = state;
  const [values, setValues] = useState<Record<string, string>>({});
  const apply = useMutation({
    mutationFn: (r: UpdateReview) => api<{ jobId: string }>("POST", `/api/apps/${d.name}/update`, { previewId: r.previewId, digest: r.digest, settings: values }),
    onSuccess: (r) => {
      setOpen(false);
      setReview(null);
      setValues({});
      onStarted(r);
      void queryClient.invalidateQueries({ queryKey: ["apps"] });
    },
  });
  if (!state.fromGithub || d.state === "removed") return null;

  // Preview changes needs a review made now; the label may come from an earlier check.
  const preview = () => {
    if (!found || found.upToDate) check.mutate(undefined, { onSuccess: () => setOpen(true) });
    else setOpen(true);
  };
  const lines = found && !found.upToDate ? describeChanges(found.changes) : [];
  const asked = found ? found.settings.filter((s) => !s.derived && (s.required || !s.set)) : [];
  const missing = asked.some((s) => s.required && !s.set && !values[s.name]);
  const kitFrom = pinned(d.kitSource);
  const kitTo = found ? pinned(found.kit.source) : null;

  return (
    <div className="kit-update" data-state={available ? "update-available" : "up-to-date"}>
      <div className="actions">
        {available ? (
          <button type="button" className="secondary" onClick={() => (open ? setOpen(false) : preview())} disabled={check.isPending}>
            {open ? "Hide changes" : "Preview changes"}
          </button>
        ) : null}
        <button type="button" className="secondary" onClick={() => check.mutate()} disabled={check.isPending}>
          {check.isPending ? "Checking…" : "Check for update"}
        </button>
      </div>
      {check.isError ? (
        <p className="notice error" role="alert">
          {errorMessage(check.error)}
        </p>
      ) : null}
      {!check.isPending && check.data?.upToDate ? <p className="muted small">Up to date with its kit.</p> : null}
      {!found && d.update?.error ? <p className="muted small">The last check for an update failed: {d.update.error}</p> : null}
      {open && found && !found.upToDate ? (
        <div className="update-changes">
          <p>
            <strong>This update changes:</strong>
          </p>
          <ul className="changes">
            {lines.map((l, i) => (
              <li key={i} data-mark={l.mark}>
                <span aria-hidden="true">{SIGN[l.mark]}</span>
                <span>{l.text}</span>
              </li>
            ))}
          </ul>
          {asked.map((s) => (
            <label key={s.name}>
              {s.name}
              <input
                type={s.secret ? "password" : "text"}
                autoComplete="off"
                required={s.required && !s.set}
                value={values[s.name] ?? ""}
                placeholder={s.set ? "Set by the kit; leave as it is" : undefined}
                onChange={(e) => setValues((v) => ({ ...v, [s.name]: e.target.value }))}
              />
            </label>
          ))}
          {!found.ok ? (
            <p className="notice error" role="alert">
              Your Space can't run this update as it is: {found.refusals.map((r) => r.reason).join(" ")}
            </p>
          ) : null}
          <details>
            <summary>What changed in the kit</summary>
            <ul className="small">
              {kitFrom && kitTo ? (
                <li>
                  <a href={`https://github.com/${kitTo.repo}/compare/${kitFrom.commit}...${kitTo.commit}`} target="_blank" rel="noreferrer">
                    The kit's changes on GitHub
                  </a>{" "}
                  (<code>{kitFrom.commit.slice(0, 7)}</code> to <code>{kitTo.commit.slice(0, 7)}</code>)
                </li>
              ) : null}
              {found.changes.compose ? (
                <li>
                  {found.changes.compose.from.repo === found.changes.compose.to.repo ? (
                    <a
                      href={`https://github.com/${found.changes.compose.to.repo}/compare/${found.changes.compose.from.commit}...${found.changes.compose.to.commit}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      The Compose file's changes on GitHub
                    </a>
                  ) : (
                    <a href={found.source.pinnedLink} target="_blank" rel="noreferrer">
                      The new Compose file on GitHub
                    </a>
                  )}
                </li>
              ) : null}
            </ul>
          </details>
          {apply.isError ? (
            <p className="notice error" role="alert">
              {errorMessage(apply.error)}
            </p>
          ) : null}
          <div className="actions">
            <button type="button" onClick={() => apply.mutate(found)} disabled={apply.isPending || !found.ok || missing}>
              Update {d.title}
            </button>
          </div>
          <p className="muted small">Its settings, data, publishing and agent access stay. If it doesn't start, it's rolled back.</p>
        </div>
      ) : null}
    </div>
  );
}
