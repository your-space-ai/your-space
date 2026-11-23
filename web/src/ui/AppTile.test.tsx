import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AppIcon, AppTile, monogram } from "./AppTile.tsx";

describe("app icons and tiles", () => {
  it("makes a monogram from the first one or two words", () => {
    expect(monogram("calendar")).toBe("C");
    expect(monogram(" Task  board ")).toBe("TB");
    expect(monogram("Écran partagé")).toBe("ÉP");
    expect(monogram("")).toBe("?");
  });

  it("links to an app by its name and status", () => {
    render(<AppTile name="Calendar" href="/open/calendar" status={{ tone: "success", label: "Running" }} />);
    const link = screen.getByRole("link", { name: "Calendar Running" });
    expect(link.getAttribute("href")).toBe("/open/calendar");
  });

  it("shows an app's own image as decoration", () => {
    const { container } = render(<AppIcon name="Notes" src="/icons/notes.png" size="small" />);
    const icon = container.firstElementChild!;
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(icon.className).toBe("ui-app-icon ui-app-icon--small");
    expect(icon.querySelector("img")?.getAttribute("alt")).toBe("");
  });
});
