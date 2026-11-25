// One knowledge base (journey 014): the apps that use it and its two-way sync with a Google Drive
// folder: when it last synced, a stopped run's reason and the owner's choices, conflict copies, and the
// files syncs replaced. The details of a sync show on demand.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../apps-api.ts";
import { ago, googleQuery, knowledgeBaseQuery, signInWithGoogle, type KnowledgeBase as Base, type KnowledgeSync, type SyncDeletion } from "../knowledge-api.ts";

export function KnowledgeBase({ name }: { name: string }) {
  const base = useQuery(knowledgeBaseQuery(name));

  if (base.isError) {
    return (
      <main className="page">
        <p className="notice error" role="alert">
          {errorMessage(base.error)}
        </p>
        <Link to="/knowledge">Back to Knowledge</Link>
      </main>
    );
  }
  if (!base.data) {
    return (
      <main className="page" aria-busy="true">
        <p className="muted">Loading…</p>
      </main>
    );
  }
  const b = base.data;
  return (
    <main className="page" data-state="knowledge-base" data-knowledge={b.name} data-sync-result={b.sync?.result ?? "none"} data-sync-running={b.sync?.running ? "true" : "false"} data-last-run={b.sync?.lastRunAt ?? ""}>
      <p>
        <Link to="/knowledge">Knowledge</Link>
      </p>
      <h1>{b.title}</h1>
      <p className="muted">
        The folder <code>{b.name}</code> in the apps you give it.{" "}
        {b.apps.length === 0
          ? "No app uses it yet."
          : `Used by ${b.apps.map((a) => a.title).join(", ")}.`}
      </p>
      {b.sync ? <Synced base={b} sync={b.sync} /> : <Connect base={b} />}
    </main>
  );
}

/** Connects a knowledge base that isn't synced to a Drive folder, by the folder's link. */
function Connect({ base }: { base: Base }) {
  const google = useQuery(googleQuery);
  const queryClient = useQueryClient();
  const [folder, setFolder] = useState("");
  const connect = useMutation({
    mutationFn: () => api("PUT", `/api/knowledge/${base.name}/sync`, { folder: folder.trim() }),
    onSuccess: async () => {
      setFolder("");
      await queryClient.invalidateQueries({ queryKey: ["knowledge"] });
    },
  });
  const ready = google.data?.state === "connected";

  return (
    <section className="card" aria-labelledby="sync-heading">
      <h2 id="sync-heading">Google Drive</h2>
      <p className="muted">
        Keep this knowledge base in two-way sync with a folder in Google Drive, so the same files are on Drive, in the apps that use it, and on
        your other devices. The first sync copies both ways and deletes nothing.
      </p>
      {google.data && !ready ? (
        <p className="notice">
          {google.data.state === "disconnected" ? "Reconnect Google Drive" : "Set up the Google Drive connection"} on the <Link to="/knowledge">Knowledge</Link>{" "}
          page first.
        </p>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          connect.mutate();
        }}
      >
        <label>
          Drive folder link
          <small>Open the folder in Drive and copy the address, or use Share, Copy link.</small>
          <input
            value={folder}
            required
            autoComplete="off"
            spellCheck={false}
            placeholder="https://drive.google.com/drive/folders/…"
            disabled={!ready}
            onChange={(event) => setFolder(event.target.value)}
          />
        </label>
        {connect.isError ? (
          <p className="notice error" role="alert">
            {errorMessage(connect.error)}
          </p>
        ) : null}
        <div>
          <button type="submit" disabled={!ready || !folder.trim() || connect.isPending}>
            {connect.isPending ? "Connecting…" : "Connect"}
          </button>
        </div>
      </form>
    </section>
  );
}

const there = (side: SyncDeletion["side"]) => (side === "local" ? "Deleted here, so deleted in Drive" : "Deleted in Drive, so deleted here");
const files = (count: number) => `${count.toLocaleString()} file${count === 1 ? "" : "s"}`;

/** The deletions a stopped run listed: the first ones, and how many more there are. */
function DeletionList({ sync }: { sync: KnowledgeSync }) {
  const more = sync.deletionCounts.local + sync.deletionCounts.remote - sync.deletions.length;
  return (
    <ul className="rows small">
      {sync.deletions.map((d) => (
        <li key={`${d.side}:${d.path}`}>
          <code>{d.path}</code> <span className="muted">{there(d.side)}</span>
        </li>
      ))}
      {more > 0 ? (
        <li className="muted" data-more-deletions>
          and {more.toLocaleString()} more file{more === 1 ? "" : "s"}
        </li>
      ) : null}
    </ul>
  );
}

function Synced({ base, sync }: { base: Base; sync: KnowledgeSync }) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const run = useMutation({
    mutationFn: (body: { action: "sync" | "resync" | "apply_deletions"; run?: string; count?: number }) => api("POST", `/api/knowledge/${base.name}/sync`, body),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["knowledge"] }),
  });
  const reconnect = useMutation({ mutationFn: signInWithGoogle });
  const disconnected = sync.disconnected || sync.result === "unauthorized";
  const stopped = sync.result === "stopped";
  const deletionCount = sync.deletionCounts.local + sync.deletionCounts.remote;
  const waitingDeletions = stopped && (sync.reason === "max_delete" || sync.reason === "changed") && deletionCount > 0 && sync.lastRunAt !== null;

  return (
    <>
      <section className="card" aria-labelledby="sync-heading" data-sync>
        <h2 id="sync-heading">Google Drive</h2>
        <p>
          Syncs with{" "}
          <a href={sync.folderUrl} target="_blank" rel="noopener noreferrer">
            its Drive folder
          </a>{" "}
          every five minutes, and when you choose Sync now.
        </p>
        <p data-sync-status aria-live="polite">
          {sync.running ? (
            <strong>{sync.firstRun ? "Syncing for the first time…" : "Syncing…"}</strong>
          ) : sync.lastSyncedAt ? (
            <>
              Last synced <time dateTime={sync.lastSyncedAt}>{ago(sync.lastSyncedAt)}</time>.
            </>
          ) : (
            "Not synced yet."
          )}
          {sync.lastRunAt && !sync.running && sync.result !== "synced" ? (
            <span className="muted">
              {" "}
              Last run <time dateTime={sync.lastRunAt}>{ago(sync.lastRunAt)}</time>.
            </span>
          ) : null}
        </p>
        {disconnected ? (
          <div className="notice error block" role="alert" data-sync-notice="disconnected">
            <p>Google refused Your Space's access to Drive, so this knowledge base doesn't sync. Its files stay, and apps keep working on them.</p>
            <button type="button" onClick={() => reconnect.mutate()} disabled={reconnect.isPending}>
              Reconnect
            </button>
            {reconnect.isError ? <p className="small">{errorMessage(reconnect.error)}</p> : null}
          </div>
        ) : !sync.running && (stopped || sync.result === "failed") ? (
          <div className={`notice block${stopped ? " error" : ""}`} role={stopped ? "alert" : "status"} data-sync-notice={sync.reason ?? sync.result}>
            <p>{sync.summary}</p>
            {sync.detail ? <p className="small muted">rclone: {sync.detail}</p> : null}
          </div>
        ) : null}
        {waitingDeletions && !sync.running ? (
          <details open data-deletions>
            <summary>{files(deletionCount)} to delete</summary>
            <DeletionList sync={sync} />
          </details>
        ) : null}
        {run.isError ? (
          <p className="notice error" role="alert">
            {errorMessage(run.error)}
          </p>
        ) : null}
        <div className="actions">
          <button type="button" onClick={() => run.mutate({ action: "sync" })} disabled={disconnected || run.isPending}>
            Sync now
          </button>
          {stopped || sync.result === "failed" ? (
            <button type="button" className="secondary" onClick={() => run.mutate({ action: "resync" })} disabled={disconnected || sync.running || run.isPending}>
              Resync
            </button>
          ) : null}
          {waitingDeletions ? (
            <button type="button" className="secondary danger-outline" onClick={() => setConfirming(true)} disabled={disconnected || sync.running || run.isPending}>
              Apply these deletions
            </button>
          ) : null}
          <button type="button" className="secondary" onClick={() => setDisconnecting(true)} disabled={sync.running}>
            Disconnect
          </button>
        </div>
        {stopped && !sync.running ? (
          <p className="muted small">Resync copies both ways and deletes nothing: a file deleted on one side comes back from the other.</p>
        ) : null}
        {sync.ties.length > 0 ? (
          <details>
            <summary className="small">
              {sync.ties.length} file{sync.ties.length === 1 ? "" : "s"} had the same time on both sides at the first sync, and the copy here replaced Drive's
            </summary>
            <ul className="rows small">
              {sync.ties.map((path) => (
                <li key={path}>
                  <code>{path}</code>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>
      {sync.conflicts.length > 0 ? <Conflicts conflicts={sync.conflicts} /> : null}
      {sync.backups.length > 0 ? <Backups backups={sync.backups} /> : null}
      {confirming ? (
        <ApplyDeletions
          base={base}
          sync={sync}
          onConfirm={() => {
            // The deletions of the run the owner sees, all of them: the server checks it is still that run's list.
            run.mutate({ action: "apply_deletions", run: sync.lastRunAt ?? "", count: deletionCount });
            setConfirming(false);
          }}
          onClose={() => setConfirming(false)}
        />
      ) : null}
      {disconnecting ? <Disconnect base={base} onClose={() => setDisconnecting(false)} /> : null}
    </>
  );
}

/** Conflict copies: both sides changed a file, so the copy here kept its name and Drive's was renamed. */
function Conflicts({ conflicts }: { conflicts: string[] }) {
  return (
    <section className="card" aria-labelledby="conflicts-heading" data-conflicts>
      <h2 id="conflicts-heading">Conflict copies</h2>
      <p className="muted">
        Both sides changed these files between two syncs. The copy here kept the file's name; Drive's copy was saved beside it with{" "}
        <code>.conflict</code> and a number at the end, on both sides. Keep what you want and delete the other copy.
      </p>
      <ul className="rows">
        {conflicts.map((path) => (
          <li key={path}>
            <code>{path}</code>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The files syncs replaced or deleted here, kept for 30 days outside the knowledge base. */
function Backups({ backups }: { backups: KnowledgeSync["backups"] }) {
  const runs = [...new Set(backups.map((b) => b.run))];
  const when = (run: string) => {
    const iso = run.replace(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, "$1:$2:$3.$4Z");
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? run : date.toLocaleString();
  };
  return (
    <section className="card" aria-labelledby="backups-heading" data-backups>
      <details>
        <summary>
          <h2 id="backups-heading" className="inline-heading">
            Replaced files
          </h2>{" "}
          <span className="muted small">
            {backups.length} file{backups.length === 1 ? "" : "s"}, kept for 30 days
          </span>
        </summary>
        <p className="muted small">
          When a sync replaced or deleted a file here, Your Space kept the earlier copy in the sync's own storage, outside the knowledge base, where
          apps don't see it. Drive keeps its replaced copies in each file's version history.
        </p>
        {runs.map((run) => (
          <div key={run}>
            <h3 className="small">{when(run)}</h3>
            <ul className="rows small">
              {backups
                .filter((b) => b.run === run)
                .map((b) => (
                  <li key={b.path}>
                    <code>{b.path}</code>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </details>
    </section>
  );
}

/** A modal of Your Space's own, never one of the browser's. */
function useModal(onClose: () => void) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => element?.close();
  }, []);
  return {
    ref: dialog,
    className: "modal",
    role: "alertdialog",
    onCancel: (event: { preventDefault: () => void }) => {
      event.preventDefault();
      onClose();
    },
    onClose,
  };
}

function ApplyDeletions({ base, sync, onConfirm, onClose }: { base: Base; sync: KnowledgeSync; onConfirm: () => void; onClose: () => void }) {
  const modal = useModal(onClose);
  // A file deleted in Drive is deleted here, and one deleted here is deleted in Drive.
  const here = sync.deletionCounts.remote;
  const drive = sync.deletionCounts.local;
  const are = (count: number) => `${files(count)} ${count === 1 ? "is" : "are"}`;
  return (
    <dialog {...modal} aria-labelledby="apply-heading" aria-describedby="apply-detail">
      <h2 id="apply-heading">Apply these deletions?</h2>
      <div id="apply-detail">
        <p>
          {[drive ? `${are(drive)} deleted in Drive` : "", here ? `${are(here)} deleted in ${base.title}` : ""].filter(Boolean).join(", and ")}, for this one sync.
          The next sync has the limit again.
        </p>
        <p className="muted small">Your Space checks the list again just before: if more files were deleted since, it deletes nothing and shows you the new list.</p>
        <DeletionList sync={sync} />
      </div>
      <div className="actions">
        <button type="button" className="danger" onClick={onConfirm}>
          Delete {files(drive + here)}
        </button>
        <button type="button" className="secondary" onClick={onClose}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}

function Disconnect({ base, onClose }: { base: Base; onClose: () => void }) {
  const queryClient = useQueryClient();
  const disconnect = useMutation({
    mutationFn: () => api<void>("DELETE", `/api/knowledge/${base.name}/sync`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["knowledge"] });
      onClose();
    },
  });
  const modal = useModal(() => {
    if (!disconnect.isPending) onClose();
  });
  return (
    <dialog {...modal} aria-labelledby="disconnect-heading" aria-describedby="disconnect-detail">
      <h2 id="disconnect-heading">Disconnect {base.title} from Drive?</h2>
      <div id="disconnect-detail">
        <p>Both keep their files: the knowledge base here, and the Drive folder. They stop syncing.</p>
        <p className="muted small">Connecting again starts with a sync that copies both ways and deletes nothing.</p>
      </div>
      {disconnect.isError ? (
        <p className="notice error" role="alert">
          {errorMessage(disconnect.error)}
        </p>
      ) : null}
      <div className="actions">
        <button type="button" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>
          {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
        </button>
        <button type="button" className="secondary" onClick={onClose} disabled={disconnect.isPending}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}
