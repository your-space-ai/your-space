// The owner's choices for publishing an app on a port of this machine, for their own proxy or tunnel
// (decision 2026-11-19), in the install review and on the app's page.

export interface PublishForm {
  port: string;
  bind: string;
  link: string;
}

export const PUBLISH_NOTE =
  "Your own proxy or tunnel, such as tailscale serve, reaches the app on this port. Your Space's sign-in doesn't guard it: the app's own sign-in does.";

/** What showing a published app inside Your Space does (decision 2026-11-20). */
export const FRAME_NOTE =
  "Your Space replaces the app's own framing rules so that only Your Space can show it in a pane; off, it opens in its own tab.";

/** The API's body for the form: an empty port means the one the app's file publishes. */
export function publishBody(form: PublishForm): { port?: number; bind: string; link: string | null } {
  return {
    ...(form.port.trim() ? { port: Number(form.port) } : {}),
    bind: form.bind.trim() || "127.0.0.1",
    link: form.link.trim() || null,
  };
}

export function PublishFields({ form, onChange, defaultPort }: { form: PublishForm; onChange: (form: PublishForm) => void; defaultPort: number | null }) {
  return (
    <div className="fields">
      <label>
        Port
        <small>A port of this machine. If something else uses it, choose another.</small>
        <input
          type="number"
          min={1}
          max={65535}
          step={1}
          value={form.port}
          placeholder={defaultPort ? String(defaultPort) : undefined}
          onChange={(e) => onChange({ ...form, port: e.target.value })}
        />
      </label>
      <label>
        Address to listen on
        <small>127.0.0.1 is this machine only; 0.0.0.0 is every network it is on.</small>
        <input type="text" autoComplete="off" value={form.bind} onChange={(e) => onChange({ ...form, bind: e.target.value })} />
      </label>
      <label>
        Link
        <small>Where you reach the app through your proxy or tunnel, like https://plane.example.com. The app's address settings use it.</small>
        <input type="url" autoComplete="off" value={form.link} placeholder="https://…" onChange={(e) => onChange({ ...form, link: e.target.value })} />
      </label>
    </div>
  );
}
