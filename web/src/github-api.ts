import { queryOptions } from "@tanstack/react-query";
import { api } from "./apps-api.ts";

/** The owner's GitHub connection, through which Your Space reads kits in private repositories. */
export type Connection = { configured: boolean; connected: boolean; login?: string; scope?: string };
export const connectionPath = "/api/repositories/connection";
export function connectionQuery(ownerId: string) {
  return queryOptions({
    queryKey: ["github-connection", ownerId],
    queryFn: () => api<Connection>("GET", connectionPath),
    enabled: !!ownerId,
    retry: false,
  });
}
