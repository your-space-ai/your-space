// Knowledge (journey 014): the owner's knowledge bases, folders of files Your Space keeps and gives to
// the apps the owner chooses. Each one's name is its folder in those apps, fixed once it is created.
// A knowledge base can sync with a Google Drive folder through the Google connection set up here.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, errorMessage } from "../apps-api.ts";
import { folderName, googleQuery, knowledgeQuery, signInWithGoogle, syncLine, type GoogleConnection, type KnowledgeBase } from "../knowledge-api.ts";

/** What the Knowledge page says when Google sends the owner back (`?google=`). */
const SIGN_IN: Record<string, { text: string; error: boolean }> = {
  connected: { text: "Signed in with Google. Open a knowledge base to connect it to a Drive folder.", error: false },
  denied: { text: "Access wasn't allowed on Google's page, so nothing changed.", error: true },
  expired: { text: "That sign-in expired or wasn't started from this browser. Sign in with Google again.", error: true },
  refused: { text: "Google refused the sign-in. Check the client ID and secret, and that the redirect URI below is registered with the client.", error: true },
  no_drive: { text: "Google didn't give access to Drive. Sign in again and allow access to your Drive files.", error: true },
  unreadable: { text: "The client secret can't be read with Your Space's data key. Save the client again.", error: true },
  signed_out: { text: "Sign in to Your Space, then sign in with Google again.", error: true },
};

export function Knowledge({ google }: { google?: string }) {
  const knowledge = useQuery(knowledgeQuery);
  const list = knowledge.data?.knowledgeBases ?? [];
  const signIn = google ? SIGN_IN[google] : undefined;

  return (
    <main className="page" data-state="knowledge">
      <h1>Knowledge</h1>
      <p className="muted">
        Folders of files you give to apps. An app you give a knowledge base finds it as a folder of its own, like{" "}
        <code>/knowledge/course-notes</code>, and reads and writes its files there.
      </p>
      {signIn ? (
        <p className={`notice${signIn.error ? " error" : ""}`} role={signIn.error ? "alert" : "status"} data-google-sign-in={google}>
          {signIn.text}
        </p>
      ) : null}
      {knowledge.isError ? (
        <p className="notice error" role="alert">
          {errorMessage(knowledge.error)}
        </p>
      ) : null}
      {knowledge.isPending ? <p className="muted">Loading…</p> : null}
      {knowledge.data && list.length === 0 ? <p className="muted">No knowledge base yet.</p> : null}
      {list.length > 0 ? (
        <ul className="app-list knowledge-list" aria-label="Knowledge bases">
          {list.map((base) => (
            <KnowledgeRow key={base.name} base={base} />
          ))}
        </ul>
      ) : null}
      <Create />
      <GoogleDrive />
    </main>
  );
}

function usedBy(base: KnowledgeBase) {
  if (base.apps.length === 0) return "Not given to any app yet.";
  return (
    <>
      Used by{" "}
      {base.apps.map((app, i) => (
        <span key={app.name}>
          {i > 0 ? ", " : null}
          <Link to="/apps/$name" params={{ name: app.name }}>
            {app.title}
          </Link>
        </span>
      ))}
    </>
  );
}

function KnowledgeRow({ base }: { base: KnowledgeBase }) {
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(base.title);
  const [deleting, setDeleting] = useState(false);
  const retitle = useMutation({
    mutationFn: () => api("PATCH", `/api/knowledge/${base.name}`, { title: title.trim() }),
    onSuccess: async () => {
      setRenaming(false);
      await queryClient.invalidateQueries({ queryKey: ["knowledge"] });
    },
  });

  return (
    <li data-knowledge={base.name}>
      {renaming ? (
        <form
          className="inline"
          onSubmit={(event) => {
            event.preventDefault();
            retitle.mutate();
          }}
        >
          <label>
            {`Title of ${base.name}`}
            <input value={title} maxLength={80} required autoFocus onChange={(event) => setTitle(event.target.value)} />
          </label>
          <button type="submit" disabled={!title.trim() || retitle.isPending}>
            Save title
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setRenaming(false);
              setTitle(base.title);
              retitle.reset();
            }}
          >
            Cancel
          </button>
          {retitle.isError ? (
            <p className="notice error" role="alert">
              {errorMessage(retitle.error)}
            </p>
          ) : null}
        </form>
      ) : (
        <>
          <div>
            <Link to="/knowledge/$name" params={{ name: base.name }}>
              <strong>{base.title}</strong>
            </Link>{" "}
            <code className="small">{base.name}</code>
            <div className="muted small">{usedBy(base)}</div>
            {base.sync ? (
              <div className={`small${base.sync.result === "stopped" || base.sync.disconnected ? " sync-attention" : " muted"}`} data-sync-line>
                {syncLine(base.sync)}
              </div>
            ) : null}
          </div>
          <div className="actions">
            <button type="button" className="secondary" onClick={() => setRenaming(true)} aria-label={`Rename ${base.title}`}>
              Rename
            </button>
            <button type="button" className="secondary danger-outline" onClick={() => setDeleting(true)} aria-label={`Delete ${base.title}`}>
              Delete
            </button>
          </div>
        </>
      )}
      {deleting ? <DeleteKnowledge base={base} onClose={() => setDeleting(false)} /> : null}
    </li>
  );
}

/**
 * Asks before deleting a knowledge base, in a modal of Your Space's own: it names the apps that use it,
 * which restart without its folder, and says its files are deleted.
 */
function DeleteKnowledge({ base, onClose }: { base: KnowledgeBase; onClose: () => void }) {
  const queryClient = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const del = useMutation({
    mutationFn: () => api<void>("DELETE", `/api/knowledge/${base.name}`),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["knowledge"] });
      void queryClient.invalidateQueries({ queryKey: ["apps"] });
    },
    onSuccess: onClose,
  });
  // No cleanup closes it: React removes the dialog with the confirmation, which takes it out of the
  // top layer, and a close() there would fire onClose after StrictMode's second showModal().
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);
  const apps = base.apps.map((app) => app.title);

  return (
    <dialog
      ref={dialog}
      className="modal"
      role="alertdialog"
      aria-labelledby={`delete-${base.name}-heading`}
      aria-describedby={`delete-${base.name}-detail`}
      // Escape closes it, as Cancel does, unless the deletion is under way.
      onCancel={(event) => {
        event.preventDefault();
        if (!del.isPending) onClose();
      }}
      // However the browser closes it, the page follows.
      onClose={onClose}
    >
      <h2 id={`delete-${base.name}-heading`}>Delete {base.title}?</h2>
      <div id={`delete-${base.name}-detail`}>
        {apps.length > 0 ? (
          <p>
            {apps.length === 1 ? `${apps[0]} uses it, and restarts` : `${apps.slice(0, -1).join(", ")} and ${apps.at(-1)} use it, and restart`} without its
            folder.
          </p>
        ) : (
          <p>No app uses it.</p>
        )}
        <p>Its files are deleted. This can't be undone.</p>
      </div>
      {del.isError ? (
        <p className="notice error" role="alert">
          {errorMessage(del.error)}
        </p>
      ) : null}
      <div className="actions">
        <button type="button" className="danger" onClick={() => del.mutate()} disabled={del.isPending}>
          {del.isPending ? "Deleting…" : "Delete knowledge base"}
        </button>
        <button type="button" className="secondary" onClick={onClose} disabled={del.isPending}>
          Cancel
        </button>
      </div>
    </dialog>
  );
}

function Create() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const create = useMutation({
    mutationFn: () => {
      const folder = name.replace(/-+$/, "");
      return api("POST", "/api/knowledge", { name: folder, ...(title.trim() ? { title: title.trim() } : {}) });
    },
    onSuccess: async () => {
      setName("");
      setTitle("");
      await queryClient.invalidateQueries({ queryKey: ["knowledge"] });
    },
  });
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <section className="card" aria-labelledby="create-knowledge-heading">
      <h2 id="create-knowledge-heading">New knowledge base</h2>
      <form onSubmit={onSubmit}>
        <label>
          Name
          <small>Its folder in every app you give it, so it can't change later: lower-case letters, digits and dashes.</small>
          <input
            value={name}
            required
            maxLength={40}
            autoComplete="off"
            placeholder="course-notes"
            // Not while one is being created, whose name and title are cleared when it is.
            disabled={create.isPending}
            onChange={(event) => {
              // An error is about what was sent: it goes once the form changes.
              if (create.isError) create.reset();
              setName(folderName(event.target.value));
            }}
          />
        </label>
        <label>
          Title
          <small>Optional, and you can change it later.</small>
          <input
            value={title}
            maxLength={80}
            autoComplete="off"
            placeholder="Course notes"
            disabled={create.isPending}
            onChange={(event) => {
              if (create.isError) create.reset();
              setTitle(event.target.value);
            }}
          />
        </label>
        {create.isError ? (
          <p className="notice error" role="alert">
            {errorMessage(create.error)}
          </p>
        ) : null}
        <div>
          <button type="submit" disabled={!name.replace(/-+$/, "") || create.isPending}>
            {create.isPending ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </section>
  );
}

/**
 * The Google connection synced knowledge bases use (journey 014): the operator's own OAuth client,
 * which Your Space keeps with its secret encrypted, and the owner's sign-in with Google. Its setup
 * steps show only until it is set up.
 */
function GoogleDrive() {
  const google = useQuery(googleQuery);
  const [changing, setChanging] = useState(false);
  const signIn = useMutation({ mutationFn: signInWithGoogle });
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: () => api<void>("DELETE", "/api/google-drive"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["google-drive"] }),
  });
  const g = google.data;

  return (
    <section className="card" aria-labelledby="google-drive-heading" data-google-state={g?.state}>
      <h2 id="google-drive-heading">Google Drive</h2>
      {google.isError ? (
        <p className="notice error" role="alert">
          {errorMessage(google.error)}
        </p>
      ) : null}
      {!g ? null : g.state === "not_set_up" || changing ? (
        <>
          <p className="muted">
            Keep a knowledge base in two-way sync with a Drive folder. Your Space signs in with an OAuth client you create in your own Google Cloud
            project, so it needs the client's ID and secret once.
          </p>
          <ClientForm google={g} onSaved={() => setChanging(false)} onCancel={g.state === "not_set_up" ? undefined : () => setChanging(false)} />
        </>
      ) : (
        <>
          {g.state === "disconnected" ? (
            <div className="notice error block" role="alert">
              <p>Google refused Your Space's access to Drive, so knowledge bases don't sync. Their files stay, and apps keep working on them.</p>
              {g.problem ? <p className="small">{g.problem}</p> : null}
            </div>
          ) : null}
          <p>
            {g.state === "connected" ? "Signed in with Google" : g.state === "disconnected" ? "Disconnected" : "Not signed in with Google yet"}, with the client{" "}
            <code className="small">{g.clientId}</code>.
            {g.state === "connected" && g.connectedAt ? <span className="muted"> Since {new Date(g.connectedAt).toLocaleString()}.</span> : null}
          </p>
          {signIn.isError ? (
            <p className="notice error" role="alert">
              {errorMessage(signIn.error)}
            </p>
          ) : null}
          {remove.isError ? (
            <p className="notice error" role="alert">
              {errorMessage(remove.error)}
            </p>
          ) : null}
          <div className="actions">
            {g.state !== "connected" ? (
              <button type="button" onClick={() => signIn.mutate()} disabled={signIn.isPending}>
                {g.state === "disconnected" ? "Reconnect" : "Sign in with Google"}
              </button>
            ) : null}
            <button type="button" className="secondary" onClick={() => setChanging(true)}>
              Change client
            </button>
            {g.knowledgeBases === 0 ? (
              <button type="button" className="secondary danger-outline" onClick={() => remove.mutate()} disabled={remove.isPending}>
                Remove connection
              </button>
            ) : null}
          </div>
        </>
      )}
    </section>
  );
}

function ClientForm({ google, onSaved, onCancel }: { google: GoogleConnection; onSaved: () => void; onCancel?: () => void }) {
  const queryClient = useQueryClient();
  const [clientId, setClientId] = useState(google.clientId ?? "");
  const [clientSecret, setClientSecret] = useState("");
  const [copied, setCopied] = useState(false);
  const save = useMutation({
    mutationFn: () => api<GoogleConnection>("PUT", "/api/google-drive", { clientId: clientId.trim(), clientSecret: clientSecret.trim() }),
    onSuccess: async () => {
      setClientSecret("");
      await queryClient.invalidateQueries({ queryKey: ["google-drive"] });
      onSaved();
    },
  });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(google.redirectUri);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <div>
        <p className="small">
          Create a <strong>Web application</strong> OAuth client, set the app's publishing status to <strong>In production</strong>, and add this{" "}
          <strong>authorized redirect URI</strong> to the client:
        </p>
        <div className="actions">
          <code data-redirect-uri>{google.redirectUri}</code>
          <button type="button" className="secondary" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="muted small">The operator guide's page "Sync knowledge bases with Google Drive" walks through each step.</p>
      </div>
      <label>
        Client ID
        <input value={clientId} required autoComplete="off" spellCheck={false} placeholder="1234-abcd.apps.googleusercontent.com" onChange={(e) => setClientId(e.target.value)} />
      </label>
      <label>
        Client secret
        <small>Kept encrypted, and never shown again.</small>
        <input type="password" value={clientSecret} required autoComplete="off" spellCheck={false} onChange={(e) => setClientSecret(e.target.value)} />
      </label>
      {google.clientId ? <p className="muted small">Saving signs Your Space out of Google: sign in again with the new client.</p> : null}
      {save.isError ? (
        <p className="notice error" role="alert">
          {errorMessage(save.error)}
        </p>
      ) : null}
      <div className="actions">
        <button type="submit" disabled={!clientId.trim() || !clientSecret.trim() || save.isPending}>
          {save.isPending ? "Saving…" : "Save client"}
        </button>
        {onCancel ? (
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
