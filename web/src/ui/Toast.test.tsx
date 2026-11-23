import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "./Button.tsx";
import { Notice, ToastProvider, useToast, type ToastOptions } from "./Toast.tsx";

function Example({ toasts }: { toasts: ToastOptions[] }) {
  const show = useToast();
  return <Button onClick={() => toasts.forEach(show)}>Show</Button>;
}

const region = () => within(screen.getByRole("region", { name: "Notifications" }));

describe("toasts", () => {
  afterEach(() => vi.useRealTimers());

  it("announces a toast and dismisses it after a while", () => {
    vi.useFakeTimers();
    render(<ToastProvider><Example toasts={[{ tone: "success", message: "View saved." }]} /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(region().getByRole("list").getAttribute("aria-live")).toBe("polite");
    expect(region().getByText("View saved.")).toBeTruthy();
    act(() => vi.advanceTimersByTime(5999));
    expect(region().queryByText("View saved.")).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(region().queryByText("View saved.")).toBeNull();
  });

  it("keeps its time when another toast arrives", () => {
    vi.useFakeTimers();
    render(<ToastProvider><Example toasts={[{ message: "Saved.", duration: 1000 }]} /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    act(() => vi.advanceTimersByTime(600));
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(region().getAllByText("Saved.")).toHaveLength(2);
    act(() => vi.advanceTimersByTime(400));
    expect(region().getAllByText("Saved.")).toHaveLength(1);
  });

  it("stays while the pointer or focus is on it", () => {
    vi.useFakeTimers();
    render(<ToastProvider><Example toasts={[{ message: "Calendar restarted.", duration: 1000 }]} /></ToastProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    const toast = region().getByRole("listitem");
    fireEvent.pointerEnter(toast);
    act(() => vi.advanceTimersByTime(5000));
    expect(region().queryByText("Calendar restarted.")).toBeTruthy();
    fireEvent.pointerLeave(toast);
    act(() => vi.advanceTimersByTime(1000));
    expect(region().queryByText("Calendar restarted.")).toBeNull();
  });

  it("runs its action, closes on Dismiss and shows at most three", () => {
    const undo = vi.fn();
    render(
      <ToastProvider>
        <Example toasts={[
          { message: "First", duration: Infinity },
          { message: "Second", duration: Infinity },
          { message: "Third", duration: Infinity, action: { label: "Undo", onSelect: undo } },
          { message: "Fourth", duration: Infinity },
        ]} />
      </ToastProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show" }));
    expect(region().getAllByRole("listitem").map((item) => item.querySelector(".ui-toast__message")?.textContent)).toEqual(["Second", "Third", "Fourth"]);
    fireEvent.click(region().getByRole("button", { name: "Undo" }));
    expect(undo).toHaveBeenCalledOnce();
    fireEvent.click(region().getAllByRole("button", { name: "Dismiss" })[0]!);
    expect(region().getAllByRole("listitem")).toHaveLength(1);
  });

  it("needs a provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Example toasts={[]} />)).toThrow("useToast needs a ToastProvider above it.");
    vi.restoreAllMocks();
  });
});

describe("Notice", () => {
  it("keeps the role it is given and its tone", () => {
    render(<Notice tone="danger" role="alert" title="Can't reach Calendar">Try again in a minute.</Notice>);
    const notice = screen.getByRole("alert");
    expect(notice.className).toBe("ui-notice ui-tone--danger");
    expect(notice.textContent).toBe("Can't reach CalendarTry again in a minute.");
  });

  it("has no role unless given one", () => {
    const { container } = render(<Notice action={<Button size="small">Update</Button>}>An update is ready.</Notice>);
    const notice = container.firstElementChild!;
    expect(notice.hasAttribute("role")).toBe(false);
    expect(notice.className).toBe("ui-notice ui-tone--info");
    expect(within(notice as HTMLElement).getByRole("button", { name: "Update" })).toBeTruthy();
  });
});
