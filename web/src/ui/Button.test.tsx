import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button, IconButton, buttonClass } from "./Button.tsx";

describe("Button", () => {
  it("is a primary button that doesn't submit a form unless asked", () => {
    const submit = vi.fn((event: SubmitEvent) => event.preventDefault());
    render(
      <form onSubmit={(event) => submit(event.nativeEvent as SubmitEvent)}>
        <Button>Save</Button>
        <Button type="submit" variant="secondary" size="small">Send</Button>
      </form>,
    );
    const save = screen.getByRole("button", { name: "Save" });
    expect(save.getAttribute("type")).toBe("button");
    expect(save.className).toBe("ui-button ui-button--primary");
    save.click();
    expect(submit).not.toHaveBeenCalled();
    const send = screen.getByRole("button", { name: "Send" });
    expect(send.className).toBe("ui-button ui-button--secondary ui-button--small");
    send.click();
    expect(submit).toHaveBeenCalledOnce();
  });

  it("shows an icon beside its label and passes other props through", () => {
    render(<Button variant="danger" icon="close" disabled data-testid="remove">Remove app</Button>);
    const button = screen.getByRole("button", { name: "Remove app" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.dataset.testid).toBe("remove");
    expect(button.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("names an icon-only button by its label", () => {
    render(<IconButton icon="more" label="More actions" />);
    const button = screen.getByRole("button", { name: "More actions" });
    expect(button.title).toBe("More actions");
    expect(button.className).toBe("ui-button ui-button--quiet ui-button--icon");
  });

  it("gives a link a button's classes", () => {
    expect(buttonClass({ variant: "secondary" }, "wide")).toBe("ui-button ui-button--secondary wide");
    expect(buttonClass()).toBe("ui-button ui-button--primary");
  });
});
