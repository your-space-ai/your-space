import { describe, expect, it } from "vitest";
import { scrub } from "../src/engine.ts";

describe("scrub", () => {
  it("hides every setting value of three characters or more, wherever it stands alone", () => {
    const env = { PIN: "4821", PASSWORD: "s3cr3t-value", EMPTY: "" };
    expect(scrub("password s3cr3t-value rejected; pin=4821", env)).toBe("password [hidden] rejected; pin=[hidden]");
  });

  it("leaves a value that only appears inside a longer word", () => {
    expect(scrub("container ys-web-1 failed: exit status 1", { N: "1", W: "web" })).toBe("container ys-[hidden]-1 failed: exit status 1");
    expect(scrub("webserver started", { W: "web" })).toBe("webserver started");
  });

  it("handles values with characters that mean something in a pattern", () => {
    expect(scrub("token a.b*c(d) used", { T: "a.b*c(d)" })).toBe("token [hidden] used");
  });
});
