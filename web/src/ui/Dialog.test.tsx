import { act, fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./Button.tsx";
import { Dialog, useConfirm } from "./Dialog.tsx";

function Example({ onClose }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Save view</Button>
      <Dialog
        open={open}
        onClose={() => { onClose?.(); setOpen(false); }}
        title="Save this view"
        description="Saved views keep their apps and layout."
        footer={<Button onClick={() => setOpen(false)}>Save</Button>}
      >
        <input aria-label="View name" data-autofocus />
      </Dialog>
    </>
  );
}

describe("Dialog", () => {
  it("opens modally, named and described, with focus on its first field", async () => {
    render(<Example />);
    await userEvent.click(screen.getByRole("button", { name: "Save view" }));
    const dialog = screen.getByRole("dialog", { name: "Save this view", description: "Saved views keep their apps and layout." });
    expect((dialog as HTMLDialogElement).open).toBe(true);
    expect(document.activeElement).toBe(screen.getByLabelText("View name"));
  });

  it("closes with Escape, its close button or a click outside, and gives focus back", async () => {
    const onClose = vi.fn();
    render(<Example onClose={onClose} />);
    const opener = screen.getByRole("button", { name: "Save view" });
    await userEvent.click(opener);
    // Escape: the browser fires cancel on the dialog.
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
    await userEvent.click(opener);
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    await userEvent.click(opener);
    await userEvent.click(screen.getByLabelText("View name"));
    expect(onClose).toHaveBeenCalledTimes(2);
    await userEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(document.activeElement).toBe(opener);
  });

  it("asks to confirm as window.confirm would, with Cancel focused first", async () => {
    const results: boolean[] = [];
    function Confirming() {
      const [confirm, dialog] = useConfirm();
      return (
        <>
          <Button onClick={async () => results.push(await confirm({ title: "Revoke this key?", body: "Other keys stay active.", confirmLabel: "Revoke key" }))}>
            Revoke
          </Button>
          {dialog}
        </>
      );
    }
    render(<Confirming />);
    const revoke = screen.getByRole("button", { name: "Revoke" });
    await userEvent.click(revoke);
    expect(screen.getByRole("alertdialog", { name: "Revoke this key?", description: "Other keys stay active." })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    await act(() => userEvent.keyboard("{Enter}"));
    expect(results).toEqual([false]);
    expect(document.activeElement).toBe(revoke);
    await userEvent.click(revoke);
    // An alert dialog has no close button and stays open on a click outside it.
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    await userEvent.click(screen.getByRole("alertdialog"));
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    const confirm = screen.getByRole("button", { name: "Revoke key" });
    expect(confirm.className).toContain("ui-button--danger");
    await act(() => userEvent.click(confirm));
    expect(results).toEqual([false, true]);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
