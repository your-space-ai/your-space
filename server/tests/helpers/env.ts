// Settings shared by the server tests.
export const TEST_SECRET = "test-only-secret-not-for-real-use-0123456789";
export const PUBLIC_URL = "http://localhost:4100";

/** The .env settings an owner writes to get this public address (server/src/config.ts). */
export function settingsFor(publicUrl: string): Record<string, string> {
  const url = new URL(publicUrl);
  if (url.protocol === "https:") return { YS_PROXY_URL: url.origin };
  if (url.hostname === "localhost") return url.port ? { YS_PORT: url.port } : {};
  throw new Error(`No setting gives the address ${publicUrl}`);
}
