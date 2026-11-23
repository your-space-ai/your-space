// The owner's home (T037): the workspace, the account, and sign out. Nothing else (FR-027).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { HomeFrame } from "../components/HomeFrame.tsx";
import { appsQuery } from "../apps-api.ts";
import { homeQuery } from "../home-api.ts";
import { authClient } from "../auth-client.ts";
import { ErrorState } from "../components/ErrorState.tsx";
import { AppError, failureForStatus, failureKind } from "../errors.ts";
import { sessionQuery, workspaceQuery } from "../queries.ts";
import { Notice } from "../ui/index.ts";

// An owner created without an email holds a reserved address that can't receive mail; it isn't
// the owner's, so it isn't shown. The server's owner rules use the same domain.
function hasOwnEmail(email: string): boolean {
  return !email.endsWith("@users.invalid");
}

export function Home() {
  const session = useQuery(sessionQuery);
  const state = useQuery(homeQuery(session.data?.user.id ?? ""));
  if (session.data && state.isPending) return <main className="panel" aria-busy="true"><p>Opening Home…</p></main>;
  if (state.data?.activeHome && !state.isError) {
    const active = state.data.activeHome;
    return <HomeFrame key={active.generation + ":" + state.data.revision} home={active} revision={state.data.revision} />;
  }
  return <BuiltInHome unavailable={state.isError || !!state.data?.selectedId} />;
}

export function BuiltInHome({ unavailable = false }: { unavailable?: boolean }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const session = useQuery(sessionQuery);
  const workspace = useQuery(workspaceQuery);
  const apps = useQuery(appsQuery);

  // A session that ends while the page is open (sign-out elsewhere, a password reset, expiry)
  // returns to sign-in rather than showing stale data (FR-016).
  const ended =
    session.data === null ||
    failureKind(session.error) === "session_expired" ||
    failureKind(workspace.error) === "session_expired";
  useEffect(() => {
    if (ended) {
      queryClient.removeQueries({ queryKey: ["workspace"] });
      queryClient.removeQueries({ queryKey: ["appearance", "library"] });
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
      queryClient.removeQueries({ queryKey: ["appearance", "library"] });
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

  // The installation has an owner, so a missing workspace means its records can't be read correctly.
  if (!ended && session.data && workspace.isSuccess && workspace.data === null) {
    return <ErrorState kind="unexpected" onRetry={() => void workspace.refetch()} retrying={workspace.isFetching} />;
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
      <h1>{workspace.data?.name}</h1>
      {unavailable ? <Notice>Your selected Home is unavailable. You can keep using the built-in dashboard.</Notice> : null}
      {apps.data ? (apps.data.apps.length ? <p><Link to="/apps">Browse installed apps</Link></p> : <section aria-label="Getting started">
        <p>Choose an app for your workspace. Its kit describes what will run, so you can review it before installing.</p>
        <Link className="button" to="/apps">Install your first kit</Link>
      </section>) : null}
      <p><Link to="/home/settings">Home settings</Link></p>
      <dl>
        <dt>Name</dt>
        <dd data-field="name">{user.name}</dd>
        <dt>Username</dt>
        <dd data-field="username">{user.username}</dd>
        {hasOwnEmail(user.email) ? (
          <>
            <dt>Email</dt>
            <dd data-field="email">{user.email}</dd>
          </>
        ) : null}
      </dl>
      {signOut.isError ? (
        <Notice tone="danger" role="alert">
          {failureKind(signOut.error) === "server_unreachable"
            ? "Couldn't sign out because Your Space isn't reachable. You are still signed in; try again."
            : "Couldn't sign out. You are still signed in; try again."}
        </Notice>
      ) : null}
      <button type="button" className="secondary" onClick={() => signOut.mutate()} disabled={signOut.isPending}>
        {signOut.isPending ? "Signing out…" : "Sign out"}
      </button>
    </main>
  );
}
