// An actions menu behind a "⋯" button, following the WAI-ARIA menu button pattern: the arrow keys,
// Home and End move between items, Escape closes it and returns focus to the button, and a click
// outside or a scroll closes it. It opens in the top layer of the page, so a pane or panel that
// clips its content doesn't cut it off.
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "./Button.tsx";
import { cx } from "./cx.ts";
import { Icon, type IconName } from "./Icon.tsx";

export type MenuAction = { label: string; onSelect: () => void; icon?: IconName; danger?: boolean; disabled?: boolean };

const gap = 4;
const margin = 8;

export function Menu({ label, items, className }: { label: string; items: (MenuAction | "separator")[]; className?: string }) {
  const [open, setOpen] = useState<false | "first" | "last">(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();

  const entries = () => Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? []);
  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) button.current?.focus();
  };

  // Place the menu under the button, toward the middle of the screen, or above the button when there
  // is no room below.
  useLayoutEffect(() => {
    const element = menu.current, anchor = button.current?.getBoundingClientRect();
    if (!open || !element || !anchor) return;
    const { width, height } = element.getBoundingClientRect();
    const start = anchor.left + anchor.width / 2 < window.innerWidth / 2 ? anchor.left : anchor.right - width;
    const left = Math.min(start, window.innerWidth - width - margin);
    const below = anchor.bottom + gap;
    const top = below + height > window.innerHeight - margin && anchor.top - gap - height >= margin ? anchor.top - gap - height : below;
    element.style.left = `${Math.max(margin, left)}px`;
    element.style.top = `${top}px`;
    const list = entries();
    (open === "last" ? list.at(-1) : list[0])?.focus({ preventScroll: true });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
    };
    const dismiss = (event: Event) => {
      if (!(event.target instanceof Node && menu.current?.contains(event.target))) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", dismiss, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", dismiss, true);
    };
  }, [open]);

  const onMenuKey = (event: KeyboardEvent) => {
    const list = entries();
    const index = list.indexOf(document.activeElement as HTMLElement);
    const target = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: list.length - 1 }[event.key];
    if (target !== undefined) {
      event.preventDefault();
      list[(target + list.length) % list.length]?.focus({ preventScroll: true });
    } else if (event.key === "Escape" || event.key === "Tab") {
      event.preventDefault();
      close(true);
    }
  };

  const onButtonKey = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(event.key === "ArrowUp" ? "last" : "first");
    }
  };

  return (
    <>
      <IconButton
        ref={button}
        icon="more"
        label={label}
        className={className}
        aria-haspopup="menu"
        aria-expanded={!!open}
        aria-controls={open ? id : undefined}
        onClick={() => (open ? close(false) : setOpen("first"))}
        onKeyDown={onButtonKey}
      />
      {open
        ? createPortal(
            <div ref={menu} id={id} role="menu" aria-label={label} className="ui-menu" onKeyDown={onMenuKey}>
              {items.map((item, index) =>
                item === "separator" ? (
                  <div key={`separator-${index}`} role="separator" className="ui-menu__separator" />
                ) : (
                  <button
                    key={item.label}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    aria-disabled={item.disabled || undefined}
                    className={cx("ui-menu__item", item.danger && "ui-menu__item--danger")}
                    onClick={() => {
                      if (item.disabled) return;
                      close(true);
                      item.onSelect();
                    }}
                  >
                    {item.icon ? <Icon name={item.icon} /> : <span className="ui-menu__spacer" />}
                    {item.label}
                  </button>
                ),
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
