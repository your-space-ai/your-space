import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Button } from "./Button.tsx";
import { ListDetail, SelectList } from "./ListDetail.tsx";

function Example() {
  const [selected, setSelected] = useState<string>();
  return (
    <ListDetail
      label="Apps"
      actions={<Button size="small" icon="plus">Install</Button>}
      view={selected ? "detail" : "list"}
      onBack={() => setSelected(undefined)}
      list={<SelectList label="Installed apps" value={selected} onChange={setSelected} items={[
        { id: "calendar", title: "Calendar", meta: "Version 2.1" },
        { id: "notes", title: "Notes", meta: "Version 1.4" },
      ]} />}
      detail={<p>{selected ? `${selected} details` : "Choose an app"}</p>}
    />
  );
}

describe("ListDetail", () => {
  it("marks the chosen item and shows its details", async () => {
    const { container } = render(<Example />);
    const layout = container.firstElementChild as HTMLElement;
    expect(screen.getByRole("region", { name: "Apps" })).toBeTruthy();
    expect(layout.dataset.view).toBe("list");
    await userEvent.click(screen.getByRole("button", { name: "Notes Version 1.4" }));
    expect(screen.getByRole("button", { name: "Notes Version 1.4" }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("button", { name: "Calendar Version 2.1" }).hasAttribute("aria-current")).toBe(false);
    expect(screen.getByText("notes details")).toBeTruthy();
    expect(layout.dataset.view).toBe("detail");
    await userEvent.click(screen.getByRole("button", { name: "Apps" }));
    expect(layout.dataset.view).toBe("list");
  });
});
