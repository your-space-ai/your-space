import { queryOptions } from "@tanstack/react-query";
import { api } from "./apps-api.ts";
import type { SavedView, ViewComposition, WorkspaceLayout } from "../../shared/workspace-layout/model.mjs";
export type { PaneLayout, SavedView, ViewComposition, WorkspaceLayout } from "../../shared/workspace-layout/model.mjs";

const base = "/api/workspace-layout";
export const workspaceLayoutQuery = queryOptions({
  queryKey: ["workspace-layout"],
  queryFn: () => api<WorkspaceLayout>("GET", base),
});
export const createView = (name: string, composition: ViewComposition) =>
  api<SavedView>("POST", base + "/views", { name, composition });
export const updateView = (id: string, revision: number, changes: { name?: string; composition?: ViewComposition }) =>
  api<SavedView>("PUT", base + "/views/" + encodeURIComponent(id), { revision, ...changes });
export const deleteView = (id: string, revision: number) =>
  api<{ ok: true }>("DELETE", base + "/views/" + encodeURIComponent(id), { revision });

