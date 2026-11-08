// Storage, connection, and session failures, each with a next step (T022, T043, FR-016).
import { WRONG_ADDRESS_FIX, type FailureKind } from "../errors.ts";

const CONTENT: Record<FailureKind, { title: string; body: string }> = {
  storage_unavailable: {
    title: "Your Space can't read its storage",
    body:
      "The database isn't responding, so Your Space can't tell what's in your workspace. Nothing has been " +
      "changed. If you run this server, check the database with `docker compose ps` and start it with " +
      "`docker compose up -d`, then try again.",
  },
  server_unreachable: {
    title: "Can't reach Your Space",
    body:
      "The server isn't responding. Check your connection. If you run this server, check that it's running " +
      "with `docker compose ps`, then try again.",
  },
  wrong_address: {
    title: "Your Space is set up for a different address",
    body: `The server answered, but it's set up for another address than the one you opened. ${WRONG_ADDRESS_FIX}`,
  },
  session_expired: {
    title: "Your session has ended",
    body: "For your security you've been signed out. Sign in again to continue.",
  },
  unexpected: {
    title: "Something went wrong",
    body: "Your Space couldn't complete that request. Nothing was reported as done. Try again.",
  },
};

export interface ErrorStateProps {
  kind: FailureKind;
  onRetry?: () => void;
  retrying?: boolean;
}

export function ErrorState({ kind, onRetry, retrying = false }: ErrorStateProps) {
  const { title, body } = CONTENT[kind];
  return (
    <main className="panel" data-state={kind}>
      <div role="alert">
        <h1>{title}</h1>
        <p>{renderCode(body)}</p>
      </div>
      {kind === "session_expired" ? (
        <a className="button" href="/sign-in">
          Sign in
        </a>
      ) : onRetry ? (
        <button type="button" onClick={onRetry} disabled={retrying}>
          {retrying ? "Trying again…" : "Try again"}
        </button>
      ) : null}
    </main>
  );
}

/** Shows `backticked` parts of a message as code. */
export function renderCode(text: string) {
  return text.split("`").map((part, i) => (i % 2 === 1 ? <code key={i}>{part}</code> : part));
}
