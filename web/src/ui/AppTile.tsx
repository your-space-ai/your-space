import type { ComponentPropsWithRef } from "react";
import { cx } from "./cx.ts";
import { StatusDot, type Tone } from "./Status.tsx";

/** The first letter of an app's name, or of its first two words. */
export function monogram(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0]!, words[1]!].map((word) => Array.from(word)[0]) : Array.from(words[0] ?? "?").slice(0, 1);
  return letters.join("").toLocaleUpperCase();
}

/** An app's icon: its image when it has one, otherwise its monogram. The app's name says the rest. */
export function AppIcon({ name, src, size = "regular" }: { name: string; src?: string; size?: "small" | "regular" | "large" }) {
  return (
    <span className={cx("ui-app-icon", `ui-app-icon--${size}`)} aria-hidden="true">
      {src ? <img src={src} alt="" /> : monogram(name)}
    </span>
  );
}

/** A link to an app with its icon, name and status, as on a launcher. */
export function AppTile({
  name, icon, status, className, ...link
}: ComponentPropsWithRef<"a"> & { name: string; icon?: string; status?: { tone: Tone; label: string } }) {
  return (
    <a {...link} className={cx("ui-app-tile", className)}>
      <AppIcon name={name} src={icon} size="large" />
      <span className="ui-app-tile__name">{name}</span>
      {status ? <> <StatusDot tone={status.tone} label={status.label} /></> : null}
    </a>
  );
}
