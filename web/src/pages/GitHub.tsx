// The GitHub page (journey 015): connect GitHub with a fine-grained token the owner creates on
// GitHub's pre-filled page and pastes here, see which account it is and whether GitHub still accepts
// it, and disconnect. It calls the same server actions as the `github` server command (decision 6),
// and never shows the token again.
import { queryOptions, useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { api, errorMessage } from "../apps-api.ts";

type TokenStatus =
  | { set: false }
  | { set: true; login: string; lastWorkedAt: string; accepted: boolean | null; problem?: "refused" | "unreadable" | "unreachable" };

interface GithubStatus {
  contents: TokenStatus;
}

// GitHub's new-token page, with a name and Contents read chosen; the owner picks the account and the
// repositories (decision 1).
const NEW_TOKEN_URL = `https://github.com/settings/personal-access-tokens/new?${new URLSearchParams({
  name: "Your Space",
  description: "Lets Your Space read kits and Compose files in the repositories you choose.",
  contents: "read",
})}`;
const TOKENS_URL = "https://github.com/settings/personal-access-tokens";

const githubQuery = queryOptions({
  queryKey: ["github"],
  queryFn: () => api<GithubStatus>("GET", "/api/github"),
  // Each visit asks GitHub about the token once; nothing asks in the background (R7).
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  retry: false,
});

// Connect and Disconnect share this key: while one is on its way, the other waits, so the page ends
// on the change the server made last (a refused token shows both).
const CHANGE = ["github", "change"];

function when(time: string): string {
  return new Date(time).toLocaleString();
}

export function GitHub() {
  const client = useQueryClient();
  const status = useQuery(githubQuery);
  const [disconnected, setDisconnected] = useState(false);
  const contents = status.data?.contents;
  // A connect or disconnect replaces the status. A status request still in flight is cancelled
  // first, or its older answer would land on top.
  const replace = async (data: GithubStatus) => {
    await client.cancelQueries({ queryKey: githubQuery.queryKey });
    client.setQueryData(githubQuery.queryKey, data);
  };

  return (
    <main className="page" data-state="github">
      <h1>GitHub</h1>
      <p className="muted">
        Connect GitHub with a token that can only read the repositories you choose. Your Space keeps it encrypted on this
        server and never gives it to apps or agents.
      </p>
      {status.isError ? (
        <p className="notice error" role="alert">
          {errorMessage(status.error)}
        </p>
      ) : null}
      {status.isPending ? <p className="muted">Loading…</p> : null}
      {disconnected && contents && !contents.set ? (
        <p className="notice" role="status">
          Disconnected. Your Space no longer holds a GitHub token, and your apps keep running. Delete the token at GitHub
          too, in <a href={TOKENS_URL} target="_blank" rel="noreferrer">your fine-grained tokens</a>.
        </p>
      ) : null}
      {contents?.set ? (
        <Connection
          contents={contents}
          onDisconnected={(data) => {
            setDisconnected(true);
            return replace(data);
          }}
        />
      ) : null}
      {contents && (!contents.set || contents.accepted === false) ? (
        <Connect
          reconnect={contents.set}
          onConnected={(data) => {
            setDisconnected(false);
            return replace(data);
          }}
        />
      ) : null}
    </main>
  );
}

function Connection({ contents, onDisconnected }: { contents: Extract<TokenStatus, { set: true }>; onDisconnected: (data: GithubStatus) => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const changing = useIsMutating({ mutationKey: CHANGE }) > 0;
  const disconnect = useMutation({
    mutationKey: CHANGE,
    mutationFn: () => api<GithubStatus>("DELETE", "/api/github"),
    onSuccess: (data) => {
      setConfirming(false);
      return onDisconnected({ contents: data.contents });
    },
  });
  const worked = <time dateTime={contents.lastWorkedAt}>{when(contents.lastWorkedAt)}</time>;
  return (
    <section className="card" aria-labelledby="connection-heading">
      <h2 id="connection-heading">Connection</h2>
      <p data-field="github-login">
        Connected as <strong>@{contents.login}</strong>
      </p>
      {contents.problem === "refused" ? (
        <p className="notice error" role="alert">
          GitHub no longer accepts this token: it expired, or it was deleted or revoked. Create a new one and reconnect.
        </p>
      ) : contents.problem === "unreadable" ? (
        <p className="notice error" role="alert">
          Your Space can't read the stored token, as when its data key was replaced without the one before it. Create a
          new token and reconnect.
        </p>
      ) : contents.problem === "unreachable" ? (
        <p className="muted">GitHub can't be asked about the token right now. It last worked {worked}.</p>
      ) : (
        <p className="muted">GitHub accepts the token. It last worked {worked}.</p>
      )}
      {confirming ? (
        <div role="alertdialog" aria-labelledby="disconnect-confirm" className="confirm">
          <p id="disconnect-confirm">
            Disconnect GitHub? Your Space forgets the token, and your apps keep running. Your Space can't delete the token at
            GitHub; you do that in your GitHub settings.
          </p>
          <div className="actions">
            <button type="button" className="danger" onClick={() => disconnect.mutate()} disabled={changing}>
              Disconnect
            </button>
            <button type="button" className="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="secondary danger-outline" onClick={() => setConfirming(true)} disabled={changing}>
          Disconnect
        </button>
      )}
      {disconnect.isError ? (
        <p className="notice error" role="alert">
          {errorMessage(disconnect.error)}
        </p>
      ) : null}
    </section>
  );
}

function Connect({ reconnect, onConnected }: { reconnect: boolean; onConnected: (data: GithubStatus) => Promise<void> }) {
  const [token, setToken] = useState("");
  // The token waits here only until the request takes it. It isn't the mutation's variables, which
  // TanStack Query keeps in its cache after the request.
  const sending = useRef("");
  const changing = useIsMutating({ mutationKey: CHANGE }) > 0;
  const connect = useMutation({
    mutationKey: CHANGE,
    mutationFn: () => {
      const value = sending.current;
      sending.current = "";
      return api<GithubStatus>("PUT", "/api/github", { token: value });
    },
    onSuccess: onConnected,
  });
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    sending.current = token;
    connect.mutate();
    // The field is cleared, whatever GitHub answers.
    setToken("");
  };
  return (
    <section className="card" aria-labelledby="connect-heading">
      <h2 id="connect-heading">{reconnect ? "Reconnect" : "Connect"}</h2>
      <ol>
        <li>
          <a className="button secondary-link" href={NEW_TOKEN_URL} target="_blank" rel="noreferrer">
            Create a token on GitHub
          </a>{" "}
          GitHub opens its new token page, with a name and read access to contents already chosen.
        </li>
        <li>Under Resource owner, choose the account or organization your repositories belong to.</li>
        <li>Under Repository access, choose Only select repositories, and pick the ones with your kits and their Compose files.</li>
        <li>Choose when it expires, then generate the token and copy it.</li>
      </ol>
      <details>
        <summary>What the token can read</summary>
        <p className="muted">
          Only the contents of the repositories you pick, and only to read them. A token reaches one account or
          organization, and not repositories where you're an outside collaborator. An organization can require approval
          for it, or block such tokens. Your Space takes only a fine-grained token: a classic token can reach every
          repository your account can, so it's refused.
        </p>
      </details>
      <form onSubmit={onSubmit}>
        <label>
          Token
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            required
            value={token}
            onChange={(event) => setToken(event.target.value)}
          />
        </label>
        <div>
          <button type="submit" disabled={changing}>
            {connect.isPending ? "Connecting…" : reconnect ? "Reconnect" : "Connect"}
          </button>
        </div>
      </form>
      {connect.isError ? (
        <p className="notice error" role="alert">
          {errorMessage(connect.error)}
        </p>
      ) : null}
    </section>
  );
}
