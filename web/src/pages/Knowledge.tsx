// Knowledge (journey 014): the owner's knowledge bases, folders of files Your Space keeps and gives to
// the apps the owner chooses. Each one's name is its folder in those apps, fixed once it is created.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, errorMessage } from "../apps-api.ts";
import { folderName, knowledgeQuery, type KnowledgeBase } from "../knowledge-api.ts";

export function Knowledge() {
  const knowledge = useQuery(knowledgeQuery);
  const list = knowledge.data?.knowledgeBases ?? [];

  return (
    <main className="page" data-state="knowledge">
      <h1>Knowledge</h1>
      <p className="muted">
        Folders of files you give to apps. An app you give a knowledge base finds it as a folder of its own, like{" "}
        <code>/knowledge/course-notes</code>, and reads and writes its files there.
      </p>
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
            <strong>{base.title}</strong> <code className="small">{base.name}</code>
            <div className="muted small">{usedBy(base)}</div>
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
            onChange={(event) => setName(folderName(event.target.value))}
          />
        </label>
        <label>
          Title
          <small>Optional, and you can change it later.</small>
          <input value={title} maxLength={80} autoComplete="off" placeholder="Course notes" disabled={create.isPending} onChange={(event) => setTitle(event.target.value)} />
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
