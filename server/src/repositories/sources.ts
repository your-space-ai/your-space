import type { GithubClient } from "./github.ts";

export type Reader = Pick<GithubClient, "repo" | "resolve" | "kitPaths">;
const link = (repo: string, commit: string, path: string) =>
  "https://github.com/" + repo + "/blob/" + commit + "/" + path.split("/").map(encodeURIComponent).join("/");

/** The kit directory's entries, read from public GitHub and pinned to the commit its default branch is at now. */
export async function catalog(reader: Reader, directory?: string) {
  if (!directory) return { commit: null, kits: [] };
  const registry = await reader.repo(directory);
  const commit = await reader.resolve(registry.id, registry.defaultBranch);
  const paths = await reader.kitPaths(registry.id, commit);
  return {
    commit,
    kits: paths.map((path) => {
      const repo = path.slice("apps/".length, -".yaml".length);
      return { title: repo.split("/")[1], repo, path, kitUrl: link(registry.fullName, commit, path) };
    }),
  };
}
