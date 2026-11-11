// Routes (T032, T038): /sign-in, / (home), and /reset-password. "No owner yet" and failures are
// states of the root route, not routes of their own (research R12).
import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRouter,
  Outlet,
  useRouter,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useState } from "react";
import { ErrorState } from "./components/ErrorState.tsx";
import { failureKind } from "./errors.ts";
import { NoOwnerYet } from "./pages/NoOwnerYet.tsx";
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

const routeTree = rootRoute.addChildren([]);

export function createAppRouter(queryClient: QueryClient) {
  return createRouter({
    routeTree,
    context: { queryClient },
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
