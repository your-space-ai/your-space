import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Menu } from "./Menu.tsx";

function setup() {
  const reload = vi.fn(), close = vi.fn(), move = vi.fn();
  render(
    <>
      <Menu
        label="Calendar actions"
        items={[
          { label: "Reload", icon: "reload", onSelect: reload },
          { label: "Move", onSelect: move, disabled: true },
          "separator",
          { label: "Close in view", onSelect: close, danger: true },
        ]}
      />
      <p>Outside</p>
    </>,
  );
  return { reload, close, move, button: screen.getByRole("button", { name: "Calendar actions" }) };
}

describe("Menu", () => {
  it("opens from its button with the first item focused", async () => {
    const { button } = setup();
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    const menu = screen.getByRole("menu", { name: "Calendar actions" });
    expect(button.getAttribute("aria-controls")).toBe(menu.id);
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Reload" }));
    await userEvent.click(button);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("moves with the arrow keys past disabled items and closes with Escape", async () => {
    const { button } = setup();
    button.focus();
    await userEvent.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Close in view" }));
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Reload" }));
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Close in view" }));
    await userEvent.keyboard("{Home}");
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Reload" }));
    await userEvent.keyboard("{End}{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("runs an item's action after closing, and ignores a disabled one", async () => {
    const { button, close, move } = setup();
    await userEvent.click(button);
    await userEvent.click(screen.getByRole("menuitem", { name: "Move" }));
    expect(move).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeTruthy();
    await userEvent.keyboard("{End}{Enter}");
    expect(close).toHaveBeenCalledOnce();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("closes on Tab and on a click outside", async () => {
    const { button } = setup();
    await userEvent.click(button);
    await userEvent.tab();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
    await userEvent.click(button);
    await userEvent.click(screen.getByText("Outside"));
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
