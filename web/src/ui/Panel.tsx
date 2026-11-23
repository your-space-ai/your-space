import { useId, type HTMLAttributes, type ReactNode } from "react";
import { cx } from "./cx.ts";

type Level = 2 | 3;

/** A surface that groups related content, with an optional title and actions. A titled panel is
 * named by its title. */
export function Panel({
  title, level = 2, actions, as: Tag = "section", className, children, ...rest
}: Omit<HTMLAttributes<HTMLElement>, "title"> & { title?: ReactNode; level?: Level; actions?: ReactNode; as?: "section" | "article" | "div" }) {
  const id = useId();
  const Heading = `h${level}` as const;
  return (
    <Tag aria-labelledby={title ? id : undefined} {...rest} className={cx("ui-panel", className)}>
      {title || actions ? (
        <header className="ui-panel__header">
          {title ? <Heading id={id} className="ui-panel__title">{title}</Heading> : null}
          {actions ? <div className="ui-panel__actions">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </Tag>
  );
}

/** The heading of a page or section, with an optional description and actions beside it. */
export function SectionHeader({
  title, level = 2, description, actions, id, className,
}: { title: ReactNode; level?: 1 | Level; description?: ReactNode; actions?: ReactNode; id?: string; className?: string }) {
  const Heading = `h${level}` as const;
  return (
    <header className={cx("ui-section-header", `ui-section-header--h${level}`, className)}>
      <div className="ui-section-header__text">
        <Heading id={id} className="ui-section-header__title">{title}</Heading>
        {description ? <p className="ui-section-header__description">{description}</p> : null}
      </div>
      {actions ? <div className="ui-section-header__actions">{actions}</div> : null}
    </header>
  );
}
