// Routes (T032, T038): /sign-in, / (home), and /reset-password. "No owner yet" and failures are
// states of the root route, not routes of their own (research R12).
import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
  redirect,
  useRouter,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useState } from "react";
import { ErrorState } from "./components/ErrorState.tsx";
import { failureKind } from "./errors.ts";
import { Home } from "./pages/Home.tsx";
import { NoOwnerYet } from "./pages/NoOwnerYet.tsx";
import { ResetPassword } from "./pages/ResetPassword.tsx";
import { SignIn, type SignInNotice } from "./pages/SignIn.tsx";
import { sessionQuery, statusQuery } from "./queries.ts";

interface RouterContext {
  queryClient: QueryClient;
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  // Every navigation re-reads whether the owner exists and who is signed in. A failed read throws,
  // which shows the error state; it is never treated as "no owner" or "signed out".
  beforeLoad: async ({ context }) => {
    const status = await context.queryClient.fetchQuery(statusQuery);
    if (!status.owner) return { owner: false, session: null };
    const session = await context.queryClient.fetchQuery(sessionQuery);
    return { owner: true, session };
  },
  component: Root,
  errorComponent: RootError,
});

function Root() {
  const { owner } = rootRoute.useRouteContext();
  return owner ? <Outlet /> : <NoOwnerYet />;
}

function RootError({ error }: ErrorComponentProps) {
  const router = useRouter();
  const [retrying, setRetrying] = useState(false);
  const retry = async () => {
    setRetrying(true);
    try {
      await router.options.context.queryClient.invalidateQueries();
      await router.invalidate();
    } finally {
      setRetrying(false);
    }
  };
  return <ErrorState kind={failureKind(error)} onRetry={retry} retrying={retrying} />;
}

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: ({ context }) => {
    if (context.owner && !context.session) throw redirect({ to: "/sign-in" });
  },
  component: Home,
});

const NOTICES: SignInNotice[] = ["password_set", "signed_out", "expired"];

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sign-in",
  validateSearch: (search: Record<string, unknown>): { notice?: SignInNotice } => {
    const notice = NOTICES.find((n) => n === search.notice);
    return notice ? { notice } : {};
  },
  beforeLoad: ({ context }) => {
    if (context.owner && context.session) throw redirect({ to: "/" });
  },
  component: SignIn,
});

const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reset-password",
  component: ResetPassword,
});

const routeTree = rootRoute.addChildren([homeRoute, signInRoute, resetPasswordRoute]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
    // Unknown addresses go to the home route, which sends signed-out visitors to sign-in.
    defaultNotFoundComponent: () => <Navigate to="/" replace />,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
