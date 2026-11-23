import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CountBadge, StatusDot, StatusPill } from "./Status.tsx";

describe("status", () => {
  it("shows a pill's label beside a decorative dot", () => {
    render(<StatusPill tone="success" data-field="state">Running</StatusPill>);
    const pill = screen.getByText("Running");
    expect(pill.className).toBe("ui-pill ui-tone--success");
    expect(pill.dataset.field).toBe("state");
    expect(pill.querySelector(".ui-dot")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps a dot's hidden label for screen readers", () => {
    render(<StatusDot tone="danger" label="Failed" hideLabel />);
    const label = screen.getByText("Failed");
    expect(label.className).toBe("ui-visually-hidden");
    expect(label.parentElement?.title).toBe("Failed");
  });

  it("follows a count with its label", () => {
    render(<CountBadge count={3} label="waiting" />);
    expect(screen.getByText("3").textContent).toBe("3 waiting");
  });

  it("defaults to the neutral tone", () => {
    render(<StatusDot label="Stopped" />);
    expect(screen.getByText("Stopped").parentElement?.className).toBe("ui-status-dot ui-tone--neutral");
  });
});
