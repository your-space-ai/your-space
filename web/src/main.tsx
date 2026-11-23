// Entry point (T021): one QueryClient and the router.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { createAppRouter } from "./router.tsx";
import { WorkspaceAppearance } from "./appearance.ts";
import "./fonts.css";
import "./styles.css";
import "./appearance.css";
import "./creator.css";
import "./ui/kit.css";

// "always": requests run even when the browser thinks it's offline, so a lost connection shows the
// "can't reach" state instead of waiting silently for the network to return.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { networkMode: "always" },
    mutations: { networkMode: "always" },
  },
});
const router = createAppRouter(queryClient);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <WorkspaceAppearance />
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
