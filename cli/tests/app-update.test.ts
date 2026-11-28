// Journey 019: `your-space app check-update` and `update` word what an update changes in plain lines.
import { describe, expect, it } from "vitest";
import { describeChanges } from "../src/commands/app.ts";

const none = { compose: null, images: [], settings: { added: [], removed: [], changed: [] }, outbound: { added: [], removed: [] }, services: { added: [], removed: [] }, interface: null };

describe("what an update changes", () => {
  it("says each change in plain words", () => {
    expect(
      describeChanges({
        compose: { from: { repo: "acme/notes", path: "compose.yaml", commit: "a".repeat(40) }, to: { repo: "acme/notes", path: "compose.yaml", commit: "b".repeat(40) } },
        images: [
          { ref: "ghcr.io/acme/notes:latest", from: "sha256:1", to: "sha256:2", private: true },
          { ref: "redis:7", from: null, to: "sha256:3", private: false },
        ],
        settings: { added: ["SMTP_HOST"], removed: ["LEGACY_MODE"], changed: ["MODE"] },
        outbound: { added: ["api.mail.example"], removed: ["old.example"] },
        services: { added: ["worker"], removed: [] },
        interface: null,
      }),
    ).toEqual([
      `Its Compose file moves to commit ${"b".repeat(12)}.`,
      "The private image ghcr.io/acme/notes:latest moves to a new version.",
      "It uses the image redis:7.",
      "A new setting, SMTP_HOST.",
      "The setting LEGACY_MODE is no longer used, and is removed.",
      "The setting MODE takes the kit's new value.",
      "It may reach api.mail.example.",
      "It no longer reaches old.example.",
      "A new service, worker.",
    ]);
  });

  it("names a Compose file the kit now pins in another repository", () => {
    expect(
      describeChanges({ ...none, compose: { from: { repo: "acme/notes", path: "compose.yaml", commit: "a".repeat(40) }, to: { repo: "acme/notes-v2", path: "deploy/compose.yaml", commit: "c".repeat(40) } } }),
    ).toEqual([`Its Compose file moves from acme/notes/compose.yaml to acme/notes-v2/deploy/compose.yaml at ${"c".repeat(12)}.`]);
  });
});
