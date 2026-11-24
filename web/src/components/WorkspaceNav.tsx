import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import type { AppSummary } from "../apps-api.ts";
import { deleteView, updateView, workspaceLayoutQuery, type SavedView } from "../workspace-layout.ts";
import "./workspace-nav.css";

export function WorkspaceNav({ apps, close }: { apps: AppSummary[]; close: () => void }) {
  const catalog = useQuery(workspaceLayoutQuery);
  const cache = useQueryClient();
  const [editing, setEditing] = useState<SavedView | null>(null);
  const [name, setName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState("");
  // An order saved before reordering left with the alpha scope (decision 2026-11-23) still applies.
  const positions = new Map(catalog.data?.appOrder.map((key, i) => [key, i]));
  const ordered = apps
    .filter((app) => app.hasInterface)
    .sort((a, b) => (positions.get(a.name) ?? Infinity) - (positions.get(b.name) ?? Infinity));
  const saved = catalog.data?.views ?? [];
  function edit(view: SavedView | null) {
    setEditing(view);
    setName(view?.name ?? "");
    setConfirmDelete(false);
    setMessage("");
  }

  const change = useMutation({
    mutationFn: async (action: "rename" | "delete") => {
      if (!editing) return;
      if (action === "rename") await updateView(editing.id, editing.revision, { name: name.trim() });
      else await deleteView(editing.id, editing.revision);
    },
    onSuccess: async () => {
      edit(null);
      await cache.invalidateQueries({ queryKey: workspaceLayoutQuery.queryKey });
    },
    onError: async (error: Error) => {
      setMessage(error.message);
      // Refresh the record, retaining the owner's unsaved name for an explicit retry.
      const fresh = await catalog.refetch();
      setEditing((previous) => fresh.data?.views.find((view) => view.id === previous?.id) ?? null);
    },
  });

  return (
    <>
      {ordered.length > 0 && (
        <section className="workspace-nav-section" aria-label="Installed apps">
          <div className="workspace-nav-heading">
            <span>Your apps</span>
          </div>
          <ul aria-label="Your apps">
            {ordered.map((app) => (
              <li key={app.name} className="workspace-nav-row">
                <Link to="/open/$name" params={{ name: app.name }} search={{}} onClick={close}>
                  {app.title}
                  {app.pendingRequests > 0 && (
                    <span className="badge" title="Access requests waiting">
                      {app.pendingRequests}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {saved.length > 0 && (
        <section className="workspace-nav-section" aria-label="Saved views">
          <div className="workspace-nav-heading">
            <span>Saved views</span>
          </div>
          <ul aria-label="Saved views">
            {saved.map((view) => {
              const first =
                view.composition.apps.find((key) => ordered.some((app) => app.name === key)) ??
                view.composition.apps[0]!;
              return (
                <li key={view.id}>
                  <div className="workspace-nav-row">
                    <Link to="/open/$name" params={{ name: first }} search={{ view: view.id }} onClick={close}>
                      <span className="nav-view-icon" aria-hidden="true" /> {view.name}
                    </Link>
                    <button
                      className="workspace-nav-options"
                      type="button"
                      aria-label={"Manage " + view.name}
                      aria-expanded={editing?.id === view.id}
                      onClick={() => edit(editing?.id === view.id ? null : view)}
                    >
                      ⋯
                    </button>
                  </div>
                  {editing?.id === view.id && (
                    <form
                      className="workspace-view-editor"
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (!change.isPending && !confirmDelete) change.mutate("rename");
                      }}
                    >
                      <label>
                        View name
                        <input value={name} maxLength={80} required onChange={(event) => setName(event.target.value)} />
                      </label>
                      <div>
                        {confirmDelete ? (
                          <>
                            <button type="button" disabled={change.isPending} onClick={() => change.mutate("delete")}>
                              Confirm delete
                            </button>
                            <button type="button" disabled={change.isPending} onClick={() => setConfirmDelete(false)}>
                              Cancel
                            </button>
                          </>
                        ) : (
                          <>
                            <button type="submit" disabled={!name.trim() || change.isPending}>
                              Save name
                            </button>
                            <button type="button" disabled={change.isPending} onClick={() => setConfirmDelete(true)}>
                              Delete view
                            </button>
                          </>
                        )}
                      </div>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {catalog.isError && (
        <button type="button" className="workspace-nav-retry" onClick={() => void catalog.refetch()}>
          Retry loading saved views
        </button>
      )}
      {message && (
        <p className="workspace-nav-message" role="status">
          {message}
        </p>
      )}
    </>
  );
}
