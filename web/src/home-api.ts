import { queryOptions } from "@tanstack/react-query";
import { api } from "./apps-api.ts";

export type HomeCandidate = {
  installationId: string;
  generation: string;
  name: string;
  title: string;
  origin: string;
  src: string;
};
export type ReadGrant = { installationId: string; bindingRevision: number; roles: string[] };
export type HomeTarget = Omit<ReadGrant, "roles"> & {
  name: string;
  title: string;
  roles: Record<string, { title: string; routes: string[] }>;
};
export type HomeState = {
  revision: number;
  selectedId: string | null;
  activeHome: HomeCandidate | null;
  candidates: HomeCandidate[];
  targets: HomeTarget[];
  grants: ReadGrant[];
};

export function homeQuery(ownerId: string) {
  return queryOptions({
    queryKey: ["home-settings", ownerId],
    queryFn: () => api<HomeState>("GET", "/api/home"),
    enabled: !!ownerId,
    retry: false,
  });
}
