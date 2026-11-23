// Tabs that follow the WAI-ARIA tabs pattern: one tab stop, arrow keys, Home and End move between
// tabs and show each one's panel.
import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { cx } from "./cx.ts";
import { CountBadge } from "./Status.tsx";

export type TabItem = { id: string; label: string; count?: number; panel: ReactNode };

export function Tabs({
  label, items, value, onChange, className,
}: { label: string; items: TabItem[]; value: string; onChange: (id: string) => void; className?: string }) {
  const base = useId();
  const tabs = useRef(new Map<string, HTMLButtonElement>());
  const current = items.find((item) => item.id === value) ?? items[0];
  if (!current) return null;
  const select = (index: number) => {
    const item = items[(index + items.length) % items.length]!;
    onChange(item.id);
    tabs.current.get(item.id)?.focus();
  };
  const move = (event: KeyboardEvent, index: number) => {
    const target = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: items.length - 1 }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    select(target);
  };
  return (
    <div className={cx("ui-tabs", className)}>
      <div role="tablist" aria-label={label} className="ui-tabs__list">
        {items.map((item, index) => {
          const selected = item.id === current.id;
          return (
            <button
              key={item.id}
              ref={(element) => {
                if (element) tabs.current.set(item.id, element);
                else tabs.current.delete(item.id);
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${item.id}`}
              aria-selected={selected}
              aria-controls={selected ? `${base}-panel` : undefined}
              tabIndex={selected ? 0 : -1}
              className="ui-tab"
              onClick={() => onChange(item.id)}
              onKeyDown={(event) => move(event, index)}
            >
              {item.label}
              {item.count ? <> <CountBadge count={item.count} /></> : null}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${current.id}`} tabIndex={0} className="ui-tabs__panel">
        {current.panel}
      </div>
    </div>
  );
}
