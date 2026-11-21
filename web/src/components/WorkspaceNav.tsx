import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import type { AppSummary } from "../apps-api.ts";
import { deleteView, saveAppOrder, updateView, workspaceLayoutQuery, type SavedView } from "../workspace-layout.ts";
import "./workspace-nav.css";

export function WorkspaceNav({ apps, close }: { apps: AppSummary[]; close: () => void }) {
  const catalog = useQuery(workspaceLayoutQuery);
  const cache = useQueryClient();
  const [arranging, setArranging] = useState(false);
  const [editing, setEditing] = useState<SavedView | null>(null);
  const [name, setName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState("");
  const dragging = useRef<string | null>(null);
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

  const reorder = useMutation({
    mutationFn: (order: string[]) => saveAppOrder(catalog.data!.revision, order),
    onSuccess: (value) => {
      cache.setQueryData(workspaceLayoutQuery.queryKey, value);
    },
    onError: async (error: Error) => {
      setMessage(error.message);
      await catalog.refetch();
    },
  });
  function move(source: string, target: string) {
    if (!catalog.data || reorder.isPending || source === target) return;
    const order = ordered.map((app) => app.name);
    const start = order.indexOf(source),
      end = order.indexOf(target);
    if (start < 0 || end < 0) return;
    order.splice(start, 1);
    order.splice(end, 0, source);
    setMessage("");
    reorder.mutate(order, {
      onSuccess: () => setMessage("Moved " + ordered[start]!.title + " to position " + (end + 1) + "."),
    });
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
            {ordered.length > 1 && catalog.data && (
              <button
                type="button"
                aria-pressed={arranging}
                onClick={() => {
                  setArranging(!arranging);
                  setMessage("");
                }}
              >
                {arranging ? "Done" : "Reorder"}
              </button>
            )}
          </div>
          <ul aria-label="Your apps">
            {ordered.map((app, index) => (
              <li
                key={app.name}
                className="workspace-nav-row"
                draggable={arranging && !reorder.isPending}
                onDragStart={(event) => {
                  if (!arranging) return;
                  dragging.current = app.name;
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("text/plain", app.name);
                }}
                onDragEnd={() => {
                  dragging.current = null;
                }}
                onDragOver={(event) => {
                  if (arranging && dragging.current) event.preventDefault();
                }}
                onDrop={(event) => {
                  if (!arranging || !dragging.current) return;
                  event.preventDefault();
                  move(dragging.current, app.name);
                  dragging.current = null;
                }}
              >
                <Link to="/open/$name" params={{ name: app.name }} search={{}} onClick={close}>
                  {app.title}
                  {app.pendingRequests > 0 && (
                    <span className="badge" title="Access requests waiting">
                      {app.pendingRequests}
                    </span>
                  )}
                </Link>
                {arranging && (
                  <span className="workspace-nav-arrows">
                    <button
                      type="button"
                      aria-label={"Move " + app.title + " up"}
                      disabled={!index || reorder.isPending}
                      onClick={() => move(app.name, ordered[index - 1]!.name)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={"Move " + app.title + " down"}
                      disabled={index === ordered.length - 1 || reorder.isPending}
                      onClick={() => move(app.name, ordered[index + 1]!.name)}
                    >
                      ↓
                    </button>
                  </span>
                )}
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
