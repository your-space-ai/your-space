import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./Button.tsx";
import { EmptyState } from "./EmptyState.tsx";
import { Panel, SectionHeader } from "./Panel.tsx";

describe("panels and headings", () => {
  it("names a panel by its title", () => {
    render(<Panel title="Status" actions={<Button size="small">Restart</Button>}><p>Running</p></Panel>);
    const panel = screen.getByRole("region", { name: "Status" });
    expect(panel.className).toBe("ui-panel");
    expect(screen.getByRole("heading", { level: 2, name: "Status" })).toBeTruthy();
  });

  it("renders an untitled panel as the element asked for", () => {
    const { container } = render(<Panel as="div" aria-label="Summary">Text</Panel>);
    expect(container.firstElementChild?.tagName).toBe("DIV");
    expect(container.querySelector("header")).toBeNull();
  });

  it("gives a section header its level, description and actions", () => {
    render(<SectionHeader level={1} id="title" title="Apps" description="Everything installed here." actions={<Button>Install</Button>} />);
    const heading = screen.getByRole("heading", { level: 1, name: "Apps" });
    expect(heading.id).toBe("title");
    expect(screen.getByText("Everything installed here.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Install" })).toBeTruthy();
  });

  it("says what an empty list holds and how to fill it", () => {
    render(<EmptyState icon="views" title="No saved views" level={3} action={<Button>Open apps</Button>}>Merge app tabs into a view, then save it.</EmptyState>);
    expect(screen.getByRole("heading", { level: 3, name: "No saved views" })).toBeTruthy();
    expect(screen.getByText("Merge app tabs into a view, then save it.")).toBeTruthy();
  });
});
