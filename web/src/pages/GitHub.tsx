import { useQuery } from "@tanstack/react-query";
import { GitHubConnection } from "../components/GitHubConnection.tsx";
import { sessionQuery } from "../queries.ts";

/** The owner's GitHub connection. Your Space reads a kit in a private repository through it. */
export function GitHub() {
  const session = useQuery(sessionQuery);
  return (
    <main className="page" data-state="github">
      <h1>GitHub</h1>
      <p className="muted">
        Connect GitHub to install apps whose kits are in your private repositories. Kits in public repositories
        install without a connection.
      </p>
      <GitHubConnection ownerId={session.data?.user.id ?? ""} />
    </main>
  );
}
