// In-app dialogs on the native <dialog> element: shown modally, so the page behind can't be reached
// with the keyboard or a screen reader, and closed with Escape. Focus returns to what opened it. The
// dashboard never uses the browser's own alert, confirm or prompt boxes.
import { useCallback, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Button, IconButton } from "./Button.tsx";
import { cx } from "./cx.ts";

export type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** An alert dialog asks for a decision: it has no close button and a click outside doesn't close it. */
  role?: "dialog" | "alertdialog";
  className?: string;
};

export function Dialog(props: DialogProps) {
  return props.open ? <OpenDialog {...props} /> : null;
}

function OpenDialog({ onClose, title, description, children, footer, role = "dialog", className }: DialogProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();

  useLayoutEffect(() => {
    const element = dialog.current!;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    element.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    return () => {
      if (element.open) element.close();
      if (opener?.isConnected && (!document.activeElement || document.activeElement === document.body || element.contains(document.activeElement))) {
        opener.focus();
      }
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      role={role === "alertdialog" ? "alertdialog" : undefined}
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-description` : undefined}
      className={cx("ui-dialog", className)}
      // Escape: the parent decides whether the dialog closes.
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (role === "dialog" && event.target === event.currentTarget) onClose();
      }}
    >
      <div className="ui-dialog__surface">
        <header className="ui-dialog__header">
          <h2 id={`${id}-title`} className="ui-dialog__title">{title}</h2>
          {role === "dialog" ? <IconButton icon="close" label="Close" size="small" onClick={() => onClose()} /> : null}
        </header>
        {description ? <div id={`${id}-description`} className="ui-dialog__description">{description}</div> : null}
        {children ? <div className="ui-dialog__body">{children}</div> : null}
        {footer ? <footer className="ui-dialog__footer">{footer}</footer> : null}
      </div>
    </dialog>
  );
}

export type ConfirmOptions = { title: ReactNode; body?: ReactNode; confirmLabel: string; cancelLabel?: string; danger?: boolean };

/** Asks the owner to confirm an action. Cancel has the focus first, so Enter alone does nothing harmful. */
export function ConfirmDialog({
  open, title, body, confirmLabel, cancelLabel = "Cancel", danger = true, onConfirm, onCancel,
}: ConfirmOptions & { open: boolean; onConfirm: () => void; onCancel: () => void }) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      role="alertdialog"
      title={title}
      description={body}
      footer={
        <>
          <Button variant="secondary" data-autofocus onClick={onCancel}>{cancelLabel}</Button>
          <Button variant={danger ? "danger" : "primary"} onClick={onConfirm}>{confirmLabel}</Button>
        </>
      }
    />
  );
}

/** A confirmation to await, as window.confirm would be: render the returned element, then
 * `if (await confirm({...}))`. */
export function useConfirm(): [(options: ConfirmOptions) => Promise<boolean>, ReactNode] {
  const [request, setRequest] = useState<(ConfirmOptions & { resolve: (confirmed: boolean) => void }) | null>(null);
  const confirm = useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => setRequest({ ...options, resolve })), []);
  const finish = (confirmed: boolean) => {
    request?.resolve(confirmed);
    setRequest(null);
  };
  const element = request ? (
    <ConfirmDialog {...request} open onConfirm={() => finish(true)} onCancel={() => finish(false)} />
  ) : null;
  return [confirm, element];
}
