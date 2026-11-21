import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, errorMessage } from "../apps-api.ts";

export function KitDirectory({ busy, onPreview }: { busy: boolean; onPreview: (url: string) => void }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const catalog = useQuery({
    queryKey: ["kit-directory"],
    queryFn: () =>
      api<{ kits: { title: string; repo: string; path: string; kitUrl: string }[]; commit: string }>(
        "GET",
        "/api/kits/catalog",
      ),
    enabled: open,
    retry: false,
    staleTime: 60_000,
  });
  return (
    <details className="kit-directory" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Kit directory</summary>
      <p className="muted">Choose a published installation kit, or paste a GitHub kit link to review it.</p>
      {open &&
        (catalog.isError ? (
          <p role="alert" className="notice error">
            The directory could not be loaded. {errorMessage(catalog.error)}{" "}
            <button type="button" className="secondary" onClick={() => void catalog.refetch()}>
              Retry directory
            </button>
          </p>
        ) : !catalog.data ? (
          <p role="status">Loading kits…</p>
        ) : catalog.data.kits.length ? (
          <ul className="rows">
            {catalog.data.kits.map((kit) => (
              <li key={kit.kitUrl}>
                <div>
                  <strong>{kit.title}</strong>
                  <div className="small muted">
                    {kit.repo} · {kit.path}
                  </div>
                </div>
                <button type="button" className="secondary" disabled={busy} onClick={() => onPreview(kit.kitUrl)}>
                  Review {kit.title}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p>No kits are listed in this directory.</p>
        ))}
      <form
        className="inline"
        onSubmit={(event) => {
          event.preventDefault();
          onPreview(url.trim());
        }}
      >
        <label>
          GitHub kit URL
          <input
            type="url"
            value={url}
            required
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://github.com/…"
          />
        </label>
        <button type="submit" className="secondary" disabled={busy}>
          Review kit URL
        </button>
      </form>
    </details>
  );
}
