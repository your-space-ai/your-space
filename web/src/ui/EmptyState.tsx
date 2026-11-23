import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon.tsx";

/** What a list or page shows when it has nothing yet: what goes here and how to add it. */
export function EmptyState({
  icon = "info", title, level = 2, children, action,
}: { icon?: IconName; title: ReactNode; level?: 2 | 3; children?: ReactNode; action?: ReactNode }) {
  const Heading = `h${level}` as const;
  return (
    <div className="ui-empty">
      <span className="ui-empty__icon"><Icon name={icon} /></span>
      <Heading className="ui-empty__title">{title}</Heading>
      {children ? <p className="ui-empty__body">{children}</p> : null}
      {action ? <div className="ui-empty__action">{action}</div> : null}
    </div>
  );
}
