// The dashboard's icons: drawn on a 24-unit grid with round strokes in the current text color, so
// they take the color of whatever holds them.
import type { ReactNode } from "react";
import { cx } from "./cx.ts";

const dot = (x: number, y: number) => <circle cx={x} cy={y} r="1.4" fill="currentColor" stroke="none" />;

const paths = {
  home: <><path d="M3.5 10.5 12 3.5l8.5 7" /><path d="M5.5 9v11.5h13V9" /><path d="M10 20.5v-6h4v6" /></>,
  apps: <><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" /></>,
  approvals: <><circle cx="12" cy="12" r="8.5" /><path d="m8.2 12.3 2.7 2.7 5-5.4" /></>,
  agents: <><rect x="5" y="8" width="14" height="11.5" rx="2.5" /><path d="M12 8V4.5" />{dot(12, 4)}{dot(9.5, 13.5)}{dot(14.5, 13.5)}</>,
  views: <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M12 4.5v15M12 12h8.5" /></>,
  settings: <><path d="M4 7.5h9M17 7.5h3M4 16.5h3M11 16.5h9" /><circle cx="15" cy="7.5" r="2" /><circle cx="9" cy="16.5" r="2" /></>,
  sidebar: <><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M9.5 4.5v15" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  more: <>{dot(5.5, 12)}{dot(12, 12)}{dot(18.5, 12)}</>,
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  chevronLeft: <path d="m14.5 5.5-6.5 6.5 6.5 6.5" />,
  chevronRight: <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />,
  chevronDown: <path d="m5.5 9.5 6.5 6.5 6.5-6.5" />,
  alert: <><path d="M12 4 3 19.5h18L12 4Z" /><path d="M12 10v4.5" />{dot(12, 17.2)}</>,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5.5" />{dot(12, 7.8)}</>,
  external: <><path d="M14 4h6v6M20 4l-8.5 8.5" /><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>,
  reload: <><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" /><path d="M19.5 4.5v4.5H15" /></>,
} satisfies Record<string, ReactNode>;

export type IconName = keyof typeof paths;
export const iconNames = Object.keys(paths) as IconName[];

/** An icon. Without a label it is decoration that assistive technology skips. */
export function Icon({ name, label, className }: { name: IconName; label?: string; className?: string }) {
  return (
    <svg
      className={cx("ui-icon", className)}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      {paths[name]}
    </svg>
  );
}
