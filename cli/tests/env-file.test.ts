import { describe, expect, it } from "vitest";
import { parseEnv, setEnv } from "../src/env-file.ts";

const EXAMPLE = `# Your Space settings.
# YS_DOMAIN=space.example.com

# YS_PROXY_URL=https://myserver.tail1234.ts.net
# YS_PORT=8081
`;

describe(".env", () => {
  it("reads settings, leaving comments out, as Compose does", () => {
    expect(parseEnv(`${EXAMPLE}YS_PORT=8082\nA="quoted value"\nB='single'\nC=plain # comment\n`)).toEqual({
      YS_PORT: "8082",
      A: "quoted value",
      B: "single",
      C: "plain",
    });
  });

  it("sets a line in place of env.example's commented one, keeping everything else", () => {
    const text = setEnv(EXAMPLE, "YS_DOMAIN", "space.example.org");
    expect(text).toBe(EXAMPLE.replace("# YS_DOMAIN=space.example.com", "YS_DOMAIN=space.example.org"));
    expect(parseEnv(text)).toEqual({ YS_DOMAIN: "space.example.org" });
  });

  it("changes a set line in place, and comments it out to clear it", () => {
    const set = setEnv(EXAMPLE, "YS_PORT", "8081");
    expect(setEnv(set, "YS_PORT", "8090")).toContain("\nYS_PORT=8090\n");
    const cleared = setEnv(set, "YS_PORT", null);
    expect(parseEnv(cleared)).toEqual({});
    expect(cleared).toContain("# YS_PORT=8081");
  });

  it("adds a setting env.example doesn't name at the end", () => {
    expect(setEnv("A=1", "YS_ENGINE_SOCKET", "/run/user/1000/docker.sock")).toBe("A=1\nYS_ENGINE_SOCKET=/run/user/1000/docker.sock\n");
    expect(setEnv("", "A", "1")).toBe("A=1\n");
  });

  it("leaves a file alone when clearing what isn't set", () => {
    expect(setEnv(EXAMPLE, "YS_DOMAIN", null)).toBe(EXAMPLE);
  });
});
