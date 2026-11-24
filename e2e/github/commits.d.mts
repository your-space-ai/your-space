/** The commit the fixture repository `owner/repo` is at, or null when there is no such fixture. */
export function fixtureCommit(repo: string): string | null;
/** A private repository that only the connected fixture account can read (api-fetch.mjs). */
export const PRIVATE_FIXTURE: { repo: string; compose: string; kit: string };
