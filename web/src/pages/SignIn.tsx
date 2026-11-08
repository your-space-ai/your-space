// Sign in with email and password (T036).
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouter, useSearch } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";
import { authClient } from "../auth-client.ts";
import { renderCode } from "../components/ErrorState.tsx";
import { WRONG_ADDRESS_FIX } from "../errors.ts";

export type SignInNotice = "password_set" | "signed_out" | "expired";

const NOTICE_TEXT: Record<SignInNotice, string> = {
  password_set: "Your password is set. Sign in with it now.",
  signed_out: "You're signed out.",
  expired: "Your session has ended. Sign in again to continue.",
};

function messageFor(status: number): string {
  if (status === 401) return "That email and password don't match.";
  if (status === 429) return "Too many sign-in attempts. Wait a few seconds, then try again.";
  if (status === 0 || status === 502 || status === 504) return "Can't reach Your Space. Check your connection and try again.";
  if (status === 503) return "Your Space can't read its storage right now. Try again shortly.";
  if (status === 421) return `Your Space is set up for a different address than this one. ${WRONG_ADDRESS_FIX}`;
  return "Sign-in didn't work. Try again.";
}

export function SignIn() {
  const { notice } = useSearch({ from: "/sign-in" });
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const result = await authClient.signIn.email({
        email: String(form.get("email")),
        password: String(form.get("password")),
      });
      if (result.error) {
        setError(messageFor(result.error.status));
        if (result.error.status >= 500) {
          // Find out whether storage or the server is the problem; the root route shows that state.
          await queryClient.invalidateQueries({ queryKey: ["status"] });
          await router.invalidate();
        }
        return;
      }
      await queryClient.invalidateQueries();
      await navigate({ to: "/" });
    } catch {
      setError(messageFor(0));
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="panel">
      <h1>Sign in to Your Space</h1>
      {notice && !error ? (
        <p className="notice" role="status">
          {NOTICE_TEXT[notice]}
        </p>
      ) : null}
      {error ? (
        <p className="notice error" role="alert">
          {renderCode(error)}
        </p>
      ) : null}
      <form onSubmit={onSubmit}>
        <label>
          Email
          <input name="email" type="email" autoComplete="username" required maxLength={254} />
        </label>
        <label>
          Password
          <input name="password" type="password" autoComplete="current-password" required maxLength={128} />
        </label>
        <button type="submit" disabled={pending}>
          {pending ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
