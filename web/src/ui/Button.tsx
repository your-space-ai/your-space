import type { ComponentPropsWithRef } from "react";
import { cx } from "./cx.ts";
import { Icon, type IconName } from "./Icon.tsx";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
export type ButtonSize = "regular" | "small";
type Options = { variant?: ButtonVariant; size?: ButtonSize };

/** The classes of a button, for a link that looks like one. */
export function buttonClass({ variant = "primary", size = "regular" }: Options = {}, className?: string) {
  return cx("ui-button", `ui-button--${variant}`, size === "small" && "ui-button--small", className);
}

export type ButtonProps = ComponentPropsWithRef<"button"> & Options & { icon?: IconName };

/** A button: primary for the main action, secondary beside it, quiet for minor actions, danger to
 * confirm something that can't be undone. It doesn't submit a form unless its type says so. */
export function Button({ variant, size, icon, className, type = "button", children, ...props }: ButtonProps) {
  return (
    <button {...props} type={type} className={buttonClass({ variant, size }, className)}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}

/** A button that shows only an icon. Its label names it for assistive technology and as a tooltip. */
export function IconButton({
  icon, label, variant = "quiet", size, className, type = "button", ...props
}: Omit<ButtonProps, "children" | "icon"> & { icon: IconName; label: string }) {
  return (
    <button {...props} type={type} aria-label={label} title={label} className={buttonClass({ variant, size }, cx("ui-button--icon", className))}>
      <Icon name={icon} />
    </button>
  );
}
