import { paneSearch } from "./pane-layout.ts";
// Routes (T032, T038): /sign-in, / (home), and /reset-password. "No owner yet" and failures are
// states of the root route, not routes of their own (research R12). Journey 002 adds the signed-in
// layout around home, /apps, /apps/$name, /open/$name (an app's pane) and /engine.
import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  lazyRouteComponent,
  Navigate,
  Outlet,
  redirect,
  useRouter,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useState } from "react";
import { ErrorState } from "./components/ErrorState.tsx";
import { Layout } from "./components/Layout.tsx";
import { Appearance } from "./pages/Appearance.tsx";
import { AppDetail } from "./pages/AppDetail.tsx";
import { Agents } from "./pages/Agents.tsx";
import { Apps } from "./pages/Apps.tsx";
import { Engine } from "./pages/Engine.tsx";
import { failureKind } from "./errors.ts";
import { BuiltInHome, Home } from "./pages/Home.tsx";
import { Repositories } from "./pages/Repositories.tsx";
import { HomeSettings } from "./pages/HomeSettings.tsx";
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

// Every page after sign-in shares Your Space's navigation.
const signedInRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "signed-in",
  beforeLoad: ({ context }) => {
    if (context.owner && !context.session) throw redirect({ to: "/sign-in" });
  },
  component: Layout,
});

const homeRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: "/",
  component: Home,
});

const homeSettingsRoute = createRoute({ getParentRoute: () => signedInRoute, path: "/home/settings", component: HomeSettings });
const builtInHomeRoute = createRoute({ getParentRoute: () => signedInRoute, path: "/home/built-in", component: BuiltInHome });

const repositoriesRoute = createRoute({
  getParentRoute: () => signedInRoute, path: "/repositories",
  validateSearch: (search: Record<string, unknown>): { app?: string } => typeof search.app === "string" && /^[a-z][a-z0-9-]{0,29}$/.test(search.app) ? { app: search.app } : {},
  component: function RepoPage() { const { app } = repositoriesRoute.useSearch(); return <Repositories key={app} appName={app} />; },
});

const appearanceRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: "/appearance",
  component: Appearance,
});

const agentsRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: "/agents",
  component: Agents,
});

const appsRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: "/apps",
  component: Apps,
});

const appDetailRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: "/apps/$name",
  component: function AppDetailPage() {
    const { name } = appDetailRoute.useParams();
    return <AppDetail key={name} name={name} />;
  },
});

const AppPane = lazyRouteComponent(() => import("./pages/AppPane.tsx"), "AppPane");

const openRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: "/open/$name",
  validateSearch: paneSearch,
  component: function OpenPage() {
    const { name } = openRoute.useParams();
    const search = openRoute.useSearch();
    return <AppPane name={name} search={search} />;
  },
});

const engineRoute = createRoute({
  getParentRoute: () => signedInRoute,
  path: "/engine",
  component: Engine,
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

const routeTree = rootRoute.addChildren([
  signedInRoute.addChildren([homeRoute, homeSettingsRoute, builtInHomeRoute, repositoriesRoute, agentsRoute, appsRoute, appDetailRoute, openRoute, engineRoute, appearanceRoute]),
  signInRoute,
  resetPasswordRoute,
]);

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
