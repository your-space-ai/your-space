// Labeled form controls. The hint and the error are linked to the control, so a screen reader reads
// them with it, and an error marks the control invalid.
import { useId, type ComponentPropsWithRef, type ReactNode } from "react";
import { cx } from "./cx.ts";
import { Icon } from "./Icon.tsx";

type FieldText = { label: ReactNode; hint?: ReactNode; error?: ReactNode };

type Described = { "aria-describedby"?: string; "aria-invalid"?: boolean | "true" | "false" | "grammar" | "spelling" };

function useField(id: string | undefined, { hint, error }: Omit<FieldText, "label">, given: Described) {
  const generated = useId();
  const control = id ?? generated;
  const ids = [hint ? control + "-hint" : "", error ? control + "-error" : "", given["aria-describedby"] ?? ""].filter(Boolean);
  return {
    control,
    // An error shown here marks the control invalid; otherwise the caller's own marking stays.
    controlProps: { id: control, "aria-invalid": error ? true : given["aria-invalid"], "aria-describedby": ids.join(" ") || undefined },
    hint: hint ? <p className="ui-field__hint" id={control + "-hint"}>{hint}</p> : null,
    error: error ? <p className="ui-field__error" id={control + "-error"}><Icon name="alert" />{error}</p> : null,
  };
}

/** A text input with its label, an optional hint and an error. */
export function TextField({ label, hint, error, id, className, ...input }: FieldText & Omit<ComponentPropsWithRef<"input">, "children">) {
  const field = useField(id, { hint, error }, input);
  return (
    <div className={cx("ui-field", className)}>
      <label className="ui-field__label" htmlFor={field.control}>{label}</label>
      {field.hint}
      <input {...input} {...field.controlProps} className="ui-input" />
      {field.error}
    </div>
  );
}

/** A select with its label, an optional hint and an error. */
export function SelectField({ label, hint, error, id, className, children, ...select }: FieldText & ComponentPropsWithRef<"select">) {
  const field = useField(id, { hint, error }, select);
  return (
    <div className={cx("ui-field", className)}>
      <label className="ui-field__label" htmlFor={field.control}>{label}</label>
      {field.hint}
      <span className="ui-select">
        <select {...select} {...field.controlProps} className="ui-input">{children}</select>
        <Icon name="chevronDown" />
      </span>
      {field.error}
    </div>
  );
}

/** An on/off switch: a checkbox with the switch role, so it works in forms and with the keyboard. */
export function Toggle({ label, hint, id, className, ...input }: Omit<FieldText, "error"> & Omit<ComponentPropsWithRef<"input">, "type" | "role" | "children">) {
  const field = useField(id, { hint }, input);
  return (
    <div className={cx("ui-toggle-field", className)}>
      <input {...input} {...field.controlProps} type="checkbox" role="switch" className="ui-toggle" />
      <div>
        <label className="ui-field__label" htmlFor={field.control}>{label}</label>
        {field.hint}
      </div>
    </div>
  );
}
