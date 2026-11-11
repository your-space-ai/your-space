// Set the first password or a new one with a link from create-owner or reset-link (T031).
// The token is in the URL fragment, which browsers never send to a server. It is read once and
// then cleared from the address bar, and posted in the request body. A new link opened in the same
// tab changes only the fragment, so the page reads the token again when the fragment changes.
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { authClient } from "../auth-client.ts";
import { renderCode } from "../components/ErrorState.tsx";
import { WRONG_ADDRESS_FIX } from "../errors.ts";

const MIN = 12;
const MAX = 128;
const NEW_LINK_HELP =
  "Ask whoever runs the server for a new link. On the server, in the folder with `compose.yaml`, run: " +
  "`docker compose exec server reset-link`";

function readToken(): string | null {
  const params = new URLSearchParams(window.location.hash.slice(1));
  const token = params.get("token");
  return token && token.length > 0 ? token : null;
}

export function ResetPassword() {
  const [token, setToken] = useState(readToken);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [linkInvalid, setLinkInvalid] = useState(false);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    function clearFragment() {
      if (window.location.hash) {
        window.history.replaceState(window.history.state, "", window.location.pathname);
      }
    }
    function onHashChange() {
      const next = readToken();
      if (next) {
        setToken(next);
        setLinkInvalid(false);
        setError(null);
      }
      clearFragment();
    }
    clearFragment();
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  if (!token || linkInvalid) {
    return (
      <main className="panel" data-state="link-invalid">
        <h1>{token ? "This link has expired or was already used" : "This link is incomplete"}</h1>
        <p>Links to set a password work once, for 30 minutes. Your password has not been changed.</p>
        <p>{renderCode(NEW_LINK_HELP)}</p>
      </main>
    );
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const newPassword = String(data.get("password"));
    if (newPassword !== String(data.get("confirm"))) {
      setError("The two passwords don't match.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await authClient.resetPassword({ newPassword, token: token! });
      if (result.error) {
        const code = (result.error as { code?: string }).code;
        if (code === "INVALID_TOKEN") setLinkInvalid(true);
        else if (result.error.status === 429) setError("Too many attempts. Wait a minute, then try again.");
        else if (code === "PASSWORD_TOO_SHORT" || code === "PASSWORD_TOO_LONG")
          setError(`Use ${MIN} to ${MAX} characters.`);
        // The page stays as it is so the link, already cleared from the address bar, can be retried.
        else if (result.error.status === 503)
          setError("Your Space can't read its storage right now, so your password wasn't changed. Try again shortly.");
        else if (result.error.status === 421)
          setError(`Your Space is set up for a different address, so your password wasn't changed. ${WRONG_ADDRESS_FIX}`);
        else if (result.error.status === 502 || result.error.status === 504)
          setError("Couldn't reach Your Space, so your password may not have been changed. Try again shortly.");
        else setError("Your password wasn't changed. Try again.");
        return;
      }
      // Setting a password signs out every session.
      queryClient.removeQueries();
      await navigate({ to: "/sign-in", search: { notice: "password_set" } });
    } catch {
      setError(
        "Couldn't reach Your Space, so your password may not have been changed. Check your connection and try again. " +
          "If the link no longer works, sign in with the new password or ask for a new link.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="panel">
      <h1>Choose your password</h1>
      <p className="muted">
        Use {MIN} to {MAX} characters. A long passphrase is a good choice. Saving it signs out every device.
      </p>
      {error ? (
        <p className="notice error" role="alert">
          {renderCode(error)}
        </p>
      ) : null}
      <form onSubmit={onSubmit}>
        <label>
          New password
          <input name="password" type="password" autoComplete="new-password" required minLength={MIN} maxLength={MAX} />
        </label>
        <label>
          Confirm the password
          <input name="confirm" type="password" autoComplete="new-password" required minLength={MIN} maxLength={MAX} />
        </label>
        <button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Set password"}
        </button>
      </form>
    </main>
  );
}
