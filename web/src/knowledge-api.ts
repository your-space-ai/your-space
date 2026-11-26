// Knowledge bases (journey 014): Your Space's own folders of files, which the owner gives to apps
// whose kits ask for knowledge.
import { queryOptions } from "@tanstack/react-query";
import { api } from "./apps-api.ts";

/** A file a sync deletes, or would: deleted on this side, so deleted on the other. */
export interface SyncDeletion {
  side: "local" | "remote";
  path: string;
}

/** A knowledge base's two-way sync with a Google Drive folder (journey 014). */
export interface KnowledgeSync {
  folderId: string;
  folderUrl: string;
  connectedAt: string;
  running: boolean;
  /** The next run copies both ways and deletes nothing. */
  firstRun: boolean;
  /** The Google connection needs the owner to sign in again. */
  disconnected: boolean;
  lastRunAt: string | null;
  lastSyncedAt: string | null;
  result: "synced" | "stopped" | "unauthorized" | "failed" | null;
  reason: "max_delete" | "too_many" | "empty" | "marker" | "resync" | "changed" | "link" | null;
  side: "local" | "remote" | null;
  summary: string | null;
  detail: string | null;
  /** The first of the deletions a stopped run listed; `deletionCounts` says how many there are. */
  deletions: SyncDeletion[];
  /** How many deletions it listed, by the side each file was deleted on. */
  deletionCounts: { local: number; remote: number };
  conflicts: string[];
  backups: { run: string; path: string; size: number }[];
  ties: string[];
}

export interface KnowledgeBase {
  name: string;
  title: string;
  createdAt: string;
  /** The installed apps given it. */
  apps: { name: string; title: string }[];
  sync: KnowledgeSync | null;
}

/** The Google connection synced knowledge bases use: the operator's OAuth client and the owner's sign-in. */
export interface GoogleConnection {
  redirectUri: string;
  clientId: string | null;
  state: "not_set_up" | "signed_out" | "connected" | "disconnected";
  problem: string | null;
  connectedAt: string | null;
  knowledgeBases: number;
}

/** Polls while a knowledge base syncs. */
const whileSyncing = (bases: KnowledgeBase[] | undefined) => (bases?.some((b) => b.sync?.running) ? 2_000 : 15_000);

export const knowledgeQuery = queryOptions({
  queryKey: ["knowledge"],
  queryFn: () => api<{ knowledgeBases: KnowledgeBase[] }>("GET", "/api/knowledge"),
  retry: false,
});

/** The list as the Knowledge page shows it, with each sync's status, which it polls; an app's page doesn't. */
export const knowledgeStatusQuery = queryOptions({
  ...knowledgeQuery,
  refetchInterval: (query) => whileSyncing(query.state.data?.knowledgeBases),
});

export const knowledgeBaseQuery = (name: string) =>
  queryOptions({
    queryKey: ["knowledge", name],
    queryFn: () => api<KnowledgeBase>("GET", `/api/knowledge/${encodeURIComponent(name)}`),
    refetchInterval: (query) => whileSyncing(query.state.data ? [query.state.data] : undefined),
    retry: false,
  });

export const googleQuery = queryOptions({
  queryKey: ["google-drive"],
  queryFn: () => api<GoogleConnection>("GET", "/api/google-drive"),
  retry: false,
});

/** Starts signing in with Google: the browser goes to Google's page and comes back to Knowledge. */
export async function signInWithGoogle(): Promise<void> {
  const { url } = await api<{ url: string }>("POST", "/api/google-drive/authorize");
  window.location.assign(url);
}

/** How long ago a time was, in words. */
export function ago(iso: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleString();
}

/** One line on how a knowledge base's sync stands, for lists. */
export function syncLine(sync: KnowledgeSync): string {
  if (sync.disconnected || sync.result === "unauthorized") return "Drive disconnected: reconnect to sync.";
  if (sync.running) return sync.firstRun ? "Syncing with Google Drive for the first time…" : "Syncing with Google Drive…";
  if (sync.result === "stopped") return "Sync stopped: it needs you.";
  if (sync.result === "failed") return `Sync didn't finish${sync.lastSyncedAt ? `; last synced ${ago(sync.lastSyncedAt)}` : ""}.`;
  if (sync.lastSyncedAt) return `Synced with Google Drive ${ago(sync.lastSyncedAt)}.`;
  return "Waiting for its first sync with Google Drive.";
}

/** A name typed for a knowledge base, as its folder will be: lower case, with dashes for spaces. */
export function folderName(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 40);
}
