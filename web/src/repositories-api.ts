import { queryOptions } from "@tanstack/react-query";
import { api } from "./apps-api.ts";

export type Repository = {
  id: string;
  fullName: string;
  origin: "created" | "forked" | "imported";
  defaultBranch: string;
  private: boolean;
};
export type RepoGrant = {
  agentId: string;
  revision: number;
  canCreate: boolean;
  canFork: boolean;
  repoIds: string[];
};
export type RepoCatalog = { repos: Repository[]; agents: { id: string; name: string }[]; grants: RepoGrant[] };
export type Connection = { configured: boolean; connected: boolean; login?: string; scope?: string };
export const reposPath = "/api/repositories";
export function connectionQuery(ownerId: string) {
  return queryOptions({
    queryKey: ["github-connection", ownerId],
    queryFn: () => api<Connection>("GET", reposPath + "/connection"),
    enabled: !!ownerId,
    retry: false,
  });
}
export function repositoryQuery(ownerId: string, login?: string) {
  return queryOptions({
    queryKey: login ? ["repositories", ownerId, login] : ["repositories", ownerId],
    queryFn: () => api<RepoCatalog>("GET", reposPath),
    enabled: !!ownerId,
    retry: false,
  });
}
