import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Tabs } from "./Tabs.tsx";

function Example() {
  const [value, setValue] = useState("access");
  return (
    <Tabs
      label="Agent details"
      value={value}
      onChange={setValue}
      items={[
        { id: "access", label: "App access", panel: <p>Roles per app</p> },
        { id: "keys", label: "Keys", count: 2, panel: <p>Two keys</p> },
        { id: "activity", label: "Activity", panel: <p>Recent calls</p> },
      ]}
    />
  );
}

describe("Tabs", () => {
  it("shows the selected tab's panel, named by its tab", async () => {
    render(<Example />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
    expect(screen.getByRole("tabpanel", { name: "App access" }).textContent).toBe("Roles per app");
    await userEvent.click(screen.getByRole("tab", { name: "Keys 2" }));
    expect(screen.getByRole("tabpanel", { name: "Keys 2" }).textContent).toBe("Two keys");
  });

  it("moves between tabs with the arrow keys, Home and End", async () => {
    render(<Example />);
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "App access" }));
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Keys 2", selected: true }));
    await userEvent.keyboard("{End}");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Activity", selected: true }));
    await userEvent.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "App access", selected: true }));
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("tabpanel").textContent).toBe("Recent calls");
    await userEvent.keyboard("{Home}");
    expect(screen.getByRole("tabpanel").textContent).toBe("Roles per app");
    await userEvent.tab();
    expect(document.activeElement).toBe(screen.getByRole("tabpanel"));
  });
});
