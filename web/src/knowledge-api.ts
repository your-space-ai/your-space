// Knowledge bases (journey 014): Your Space's own folders of files, which the owner gives to apps
// whose kits ask for knowledge.
import { queryOptions } from "@tanstack/react-query";
import { api } from "./apps-api.ts";

export interface KnowledgeBase {
  name: string;
  title: string;
  createdAt: string;
  /** The installed apps given it. */
  apps: { name: string; title: string }[];
}

export const knowledgeQuery = queryOptions({
  queryKey: ["knowledge"],
  queryFn: () => api<{ knowledgeBases: KnowledgeBase[] }>("GET", "/api/knowledge"),
  retry: false,
});

/** A name typed for a knowledge base, as its folder will be: lower case, with dashes for spaces. */
export function folderName(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+/, "")
    .slice(0, 40);
}
