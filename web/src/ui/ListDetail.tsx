// A list beside the selected item's details. On a narrow container it shows one at a time: the list,
// or the details with a way back to the list. Each side scrolls on its own, so choosing an item keeps
// the list where it was. When a narrow container swaps sides, focus goes to the details, and back to
// the item that opened them.
import { useId, useLayoutEffect, useRef, type ReactNode } from "react";
import { Button } from "./Button.tsx";
import { cx } from "./cx.ts";

export function ListDetail({
  label, actions, list, detail, view = "list", onBack, className,
}: {
  label: string;
  actions?: ReactNode;
  list: ReactNode;
  detail: ReactNode;
  /** Which side a narrow container shows. */
  view?: "list" | "detail";
  onBack?: () => void;
  className?: string;
}) {
  const id = useId();
  const listPane = useRef<HTMLElement>(null);
  const detailPane = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const shown = useRef(view);
  useLayoutEffect(() => {
    if (shown.current === view) return;
    shown.current = view;
    const hidden = (element: HTMLElement | null) => !element || element.getClientRects().length === 0;
    const focused = document.activeElement;
    if (view === "detail" && hidden(listPane.current)) {
      opener.current = focused instanceof HTMLElement && listPane.current?.contains(focused) ? focused : null;
      detailPane.current?.focus({ preventScroll: true });
    } else if (view === "list" && hidden(detailPane.current) && opener.current?.isConnected) {
      opener.current.focus({ preventScroll: true });
    }
  }, [view]);
  return (
    <div className={cx("ui-list-detail", className)} data-view={view}>
      <section ref={listPane} className="ui-list-detail__list" aria-labelledby={id}>
        <header className="ui-list-detail__header">
          <h2 id={id} className="ui-list-detail__title">{label}</h2>
          {actions}
        </header>
        <div className="ui-list-detail__scroll">{list}</div>
      </section>
      <div ref={detailPane} className="ui-list-detail__detail" tabIndex={-1}>
        {onBack ? <Button variant="quiet" size="small" icon="chevronLeft" className="ui-list-detail__back" onClick={onBack}>{label}</Button> : null}
        {detail}
      </div>
    </div>
  );
}

export type ListOption = { id: string; title: ReactNode; meta?: ReactNode; icon?: ReactNode; status?: ReactNode };

/** The items of a list beside details. The selected one is marked as current. */
export function SelectList({ label, items, value, onChange }: { label: string; items: ListOption[]; value?: string; onChange: (id: string) => void }) {
  return (
    <ul className="ui-select-list" aria-label={label}>
      {items.map((item) => (
        <li key={item.id}>
          <button type="button" className="ui-select-list__item" aria-current={item.id === value ? "true" : undefined} onClick={() => onChange(item.id)}>
            {item.icon}
            <span className="ui-select-list__text">
              <span className="ui-select-list__title">{item.title}</span>
              {item.meta ? <> <span className="ui-select-list__meta">{item.meta}</span></> : null}
            </span>
            {item.status ? <> {item.status}</> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}
