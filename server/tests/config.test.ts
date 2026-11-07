// T006: configuration is validated at startup with messages that say what to fix.
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.ts";

const VALID = {
  YS_PUBLIC_URL: "https://space.example.com",
  DATABASE_URL: "postgres://yourspace:secret@postgres:5432/yourspace",
  BETTER_AUTH_SECRET: "a-test-secret-that-is-long-enough-0123456789",
};

function problems(env: Record<string, string | undefined>): string[] {
  try {
    loadConfig(env);
    return [];
  } catch (error) {
    if (error instanceof ConfigError) return error.problems;
    throw error;
  }
}

describe("loadConfig", () => {
  it.each(["https://space.example.com", "http://localhost", "http://127.0.0.1", "https://space.example.com:8443"])(
    "accepts %s",
    (url) => {
      expect(loadConfig({ ...VALID, YS_PUBLIC_URL: url }).publicUrl).toBe(url);
    },
  );

  it.each([
    ["https://space.example.com/", /exactly as https:\/\/space\.example\.com/],
    ["https://space.example.com:443", /exactly as https:\/\/space\.example\.com/],
    ["https://Space.Example.com", /exactly as https:\/\/space\.example\.com/],
    ["https://space.example.com/app", /no path/],
    ["http://192.168.1.20", /plain http:\/\/ for a host other than localhost/],
    ["ftp://space.example.com", /must start with https:\/\//],
    ["space.example.com", /not a valid URL/],
  ])("refuses YS_PUBLIC_URL=%s", (url, message) => {
    const found = problems({ ...VALID, YS_PUBLIC_URL: url });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatch(message);
  });

  it("lists every missing or malformed setting at once", () => {
    const found = problems({ DATABASE_URL: "mysql://x", BETTER_AUTH_SECRET: "short" });
    expect(found).toHaveLength(3);
    expect(found.join("\n")).toMatch(/YS_PUBLIC_URL is not set/);
    expect(found.join("\n")).toMatch(/DATABASE_URL must be a postgres:\/\/ URL/);
    expect(found.join("\n")).toMatch(/BETTER_AUTH_SECRET must be at least 32 characters/);
  });
});
