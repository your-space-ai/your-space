// Notices in the page and toasts over it. A notice stays where it is until what it describes
// changes; a toast confirms something that just happened and goes away by itself, unless the
// pointer or focus is on it.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from "react";
import { Button, IconButton } from "./Button.tsx";
import { cx } from "./cx.ts";
import { Icon, type IconName } from "./Icon.tsx";
import type { Tone } from "./Status.tsx";

type NoticeTone = Exclude<Tone, "neutral">;
const icons: Record<NoticeTone, IconName> = { info: "info", success: "check", warning: "alert", danger: "alert" };

/** A message in the page. Give it role="alert" for an error the owner must see now, or
 * role="status" for news that shouldn't interrupt. */
export function Notice({
  tone = "info", title, action, className, children, ...rest
}: Omit<HTMLAttributes<HTMLDivElement>, "title"> & { tone?: NoticeTone; title?: ReactNode; action?: ReactNode }) {
  return (
    <div {...rest} className={cx("ui-notice", `ui-tone--${tone}`, className)}>
      <Icon name={icons[tone]} />
      <div className="ui-notice__body">
        {title ? <strong className="ui-notice__title">{title}</strong> : null}
        {children}
      </div>
      {action ? <div className="ui-notice__action">{action}</div> : null}
    </div>
  );
}

export type ToastOptions = { tone?: NoticeTone; message: ReactNode; action?: { label: string; onSelect: () => void }; duration?: number };
type Toast = ToastOptions & { id: number };

const ToastContext = createContext<((toast: ToastOptions) => void) | null>(null);

/** Shows toasts at the bottom of the screen and announces them politely. At most three show at once. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(0);
  const show = useCallback((toast: ToastOptions) => {
    const id = ++next.current;
    setToasts((list) => [...list.slice(-2), { ...toast, id }]);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((toast) => toast.id !== id)), []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <section className="ui-toasts" aria-label="Notifications">
        <ol aria-live="polite" aria-relevant="additions text">
          {toasts.map((toast) => <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />)}
        </ol>
      </section>
    </ToastContext.Provider>
  );
}

// Its timer waits while the pointer is over it or focus is in it, and restarts when both have left;
// another toast arriving doesn't restart it.
function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const { id, tone = "info", message, action, duration = 6000 } = toast;
  const [pointer, setPointer] = useState(false);
  const [focus, setFocus] = useState(false);
  const held = pointer || focus;
  useEffect(() => {
    if (held || !Number.isFinite(duration)) return;
    const timer = setTimeout(() => onDismiss(id), duration);
    return () => clearTimeout(timer);
  }, [held, duration, id, onDismiss]);
  return (
    <li
      className={cx("ui-toast", `ui-tone--${tone}`)}
      onPointerEnter={() => setPointer(true)}
      onPointerLeave={() => setPointer(false)}
      onFocus={() => setFocus(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocus(false);
      }}
    >
      <Icon name={icons[tone]} />
      <div className="ui-toast__message">{message}</div>
      {action ? (
        <Button variant="quiet" size="small" onClick={() => { action.onSelect(); onDismiss(id); }}>{action.label}</Button>
      ) : null}
      <IconButton icon="close" label="Dismiss" size="small" onClick={() => onDismiss(id)} />
    </li>
  );
}

/** Shows a toast. Needs a ToastProvider above it. */
export function useToast() {
  const show = useContext(ToastContext);
  if (!show) throw new Error("useToast needs a ToastProvider above it.");
  return show;
}
