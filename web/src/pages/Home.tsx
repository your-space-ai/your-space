// The owner's home (T037): the workspace, the account, and sign out. Nothing else (FR-027).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { authClient } from "../auth-client.ts";
import { ErrorState } from "../components/ErrorState.tsx";
import { AppError, failureForStatus, failureKind } from "../errors.ts";
import { sessionQuery, workspaceQuery } from "../queries.ts";

export function Home() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useQuery(sessionQuery);
  const workspace = useQuery(workspaceQuery);

  // A session that ends while the page is open (sign-out elsewhere, a password reset, expiry)
  // returns to sign-in rather than showing stale data (FR-016).
  const ended =
    session.data === null ||
    failureKind(session.error) === "session_expired" ||
    failureKind(workspace.error) === "session_expired";
  useEffect(() => {
    if (ended) {
      queryClient.removeQueries({ queryKey: ["workspace"] });
      void navigate({ to: "/sign-in", search: { notice: "expired" } });
    }
  }, [ended, navigate, queryClient]);

  const signOut = useMutation({
    mutationFn: async () => {
      const result = await authClient.signOut();
      if (result.error) throw new AppError(failureForStatus(result.error.status));
    },
    onSuccess: async () => {
      queryClient.removeQueries({ queryKey: ["session"] });
      queryClient.removeQueries({ queryKey: ["workspace"] });
      await navigate({ to: "/sign-in", search: { notice: "signed_out" } });
    },
  });

  const failed = session.error ?? workspace.error;
  if (failed && !ended) {
    return (
      <ErrorState
        kind={failureKind(failed)}
        onRetry={() => {
          void session.refetch();
          void workspace.refetch();
        }}
        retrying={session.isFetching || workspace.isFetching}
      />
    );
  }

  if (ended || !session.data || workspace.isPending) {
    return (
      <main className="panel" aria-busy="true">
        <p className="muted">Loading…</p>
      </main>
    );
  }

  const { user } = session.data;
  return (
    <main className="panel" data-state="home">
      <h1>{workspace.data?.name ?? "Your workspace"}</h1>
      <p className="muted">Nothing is in this workspace yet.</p>
      <dl>
        <dt>Name</dt>
        <dd data-field="name">{user.name}</dd>
        <dt>Email</dt>
        <dd data-field="email">{user.email}</dd>
      </dl>
      {signOut.isError ? (
        <p className="notice error" role="alert">
          {failureKind(signOut.error) === "server_unreachable"
            ? "Couldn't sign out because Your Space isn't reachable. You are still signed in; try again."
            : "Couldn't sign out. You are still signed in; try again."}
        </p>
      ) : null}
      <button type="button" className="secondary" onClick={() => signOut.mutate()} disabled={signOut.isPending}>
        {signOut.isPending ? "Signing out…" : "Sign out"}
      </button>
    </main>
  );
}
