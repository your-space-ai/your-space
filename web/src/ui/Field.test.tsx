import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { SelectField, TextField, Toggle } from "./Field.tsx";

const description = (element: HTMLElement) =>
  (element.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean).map((id) => document.getElementById(id)?.textContent);

describe("fields", () => {
  it("labels a text input and links its hint and error", () => {
    render(<TextField label="Username" hint="Letters and numbers." error="Choose another username." defaultValue="owner" />);
    const input = screen.getByLabelText("Username");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(description(input)).toEqual(["Letters and numbers.", "Choose another username."]);
  });

  it("keeps a valid input unmarked and keeps a description it was given", () => {
    render(<><p id="extra">Shown on sign-in.</p><TextField label="Name" id="name" aria-describedby="extra" /></>);
    const input = screen.getByLabelText("Name");
    expect(input.id).toBe("name");
    expect(input.hasAttribute("aria-invalid")).toBe(false);
    expect(description(input)).toEqual(["Shown on sign-in."]);
  });

  it("labels a select", async () => {
    render(<SelectField label="Role" defaultValue="viewer"><option value="viewer">Viewer</option><option value="editor">Editor</option></SelectField>);
    const select = screen.getByLabelText("Role") as HTMLSelectElement;
    await userEvent.selectOptions(select, "editor");
    expect(select.value).toBe("editor");
  });

  it("is a switch that the keyboard turns on and off", async () => {
    function Example() {
      const [on, setOn] = useState(false);
      return <Toggle label="Internet access" hint="The app can reach the hosts you allow." checked={on} onChange={(event) => setOn(event.target.checked)} />;
    }
    render(<Example />);
    const toggle = screen.getByRole("switch", { name: "Internet access" }) as HTMLInputElement;
    expect(description(toggle)).toEqual(["The app can reach the hosts you allow."]);
    expect(toggle.checked).toBe(false);
    await userEvent.tab();
    expect(document.activeElement).toBe(toggle);
    await userEvent.keyboard(" ");
    expect(toggle.checked).toBe(true);
    await userEvent.click(screen.getByText("Internet access"));
    expect(toggle.checked).toBe(false);
  });
});
