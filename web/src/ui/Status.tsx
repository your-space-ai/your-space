import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx.ts";

/** What a status means. Neutral is muted; info uses the accent. */
export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

/** A status as a labeled pill. The colored dot repeats the label, which always carries the meaning. */
export function StatusPill({ tone = "neutral", className, children, ...rest }: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span {...rest} className={cx("ui-pill", `ui-tone--${tone}`, className)}>
      <span className="ui-dot" aria-hidden="true" />
      {children}
    </span>
  );
}

/** A status as a colored dot and its label. A hidden label is still read by screen readers. */
export function StatusDot({ tone = "neutral", label, hideLabel = false }: { tone?: Tone; label: string; hideLabel?: boolean }) {
  return (
    <span className={cx("ui-status-dot", `ui-tone--${tone}`)} title={hideLabel ? label : undefined}>
      <span className="ui-dot" aria-hidden="true" />
      <span className={hideLabel ? "ui-visually-hidden" : undefined}>{label}</span>
    </span>
  );
}

/** A count, such as items waiting. The optional label follows the number for screen readers. */
export function CountBadge({ count, label }: { count: number; label?: ReactNode }) {
  return (
    <span className="ui-count">
      {count}
      {label ? <span className="ui-visually-hidden"> {label}</span> : null}
    </span>
  );
}
