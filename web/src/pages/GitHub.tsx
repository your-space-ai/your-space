// The GitHub page (journey 015): connect GitHub with a fine-grained token the owner creates on
// GitHub's pre-filled page and pastes here, see which account it is and whether GitHub still accepts
// it, and disconnect. An optional image token, a classic token with only read:packages, pulls private
// images from GitHub's container registry; it is added, replaced and removed on its own (decision 4).
// It calls the same server actions as the `github` server command (decision 6), and never shows a
// token again.
import { queryOptions, useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { api, errorMessage } from "../apps-api.ts";

type TokenStatus =
  | { set: false }
  | { set: true; login: string; lastWorkedAt: string; accepted: boolean | null; problem?: "refused" | "unreadable" | "unreachable" };

interface GithubStatus {
  contents: TokenStatus;
  images: TokenStatus;
}

// GitHub's new-token page, with a name and Contents read chosen; the owner picks the account and the
// repositories (decision 1).
const NEW_TOKEN_URL = `https://github.com/settings/personal-access-tokens/new?${new URLSearchParams({
  name: "Your Space",
  description: "Lets Your Space read kits and Compose files in the repositories you choose.",
  contents: "read",
})}`;
const TOKENS_URL = "https://github.com/settings/personal-access-tokens";
// GitHub's new classic token page, with a note and read:packages chosen (decision 4).
const NEW_IMAGE_TOKEN_URL = `https://github.com/settings/tokens/new?${new URLSearchParams({
  description: "Your Space images",
  scopes: "read:packages",
})}`;
const CLASSIC_TOKENS_URL = "https://github.com/settings/tokens";

const githubQuery = queryOptions({
  queryKey: ["github"],
  queryFn: () => api<GithubStatus>("GET", "/api/github"),
  // Each visit asks GitHub about the token once; nothing asks in the background (R7).
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
  retry: false,
});

// Every change shares this key: while one is on its way, the others wait, so the page ends on the
// change the server made last (a refused token shows both Connection and Reconnect).
const CHANGE = ["github", "change"];

function when(time: string): string {
  return new Date(time).toLocaleString();
}

export function GitHub() {
  const client = useQueryClient();
  const status = useQuery(githubQuery);
  const [disconnected, setDisconnected] = useState(false);
  const contents = status.data?.contents;
  const images = status.data?.images;
  // A change replaces what it changed of the status. A status request still in flight is cancelled
  // first, or its older answer would land on top.
  const replace = async (data: Partial<GithubStatus>) => {
    await client.cancelQueries({ queryKey: githubQuery.queryKey });
    client.setQueryData(githubQuery.queryKey, (before: GithubStatus | undefined) => before && { ...before, ...data });
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
          Disconnected. Your Space no longer holds a GitHub token, and your apps keep running. Delete the tokens at GitHub
          too, in <a href={TOKENS_URL} target="_blank" rel="noreferrer">your fine-grained tokens</a>, and an image token in{" "}
          <a href={CLASSIC_TOKENS_URL} target="_blank" rel="noreferrer">your classic tokens</a>.
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
      {images ? <Images images={images} onChanged={replace} /> : null}
    </main>
  );
}

function Connection({ contents, onDisconnected }: { contents: Extract<TokenStatus, { set: true }>; onDisconnected: (data: Partial<GithubStatus>) => Promise<void> }) {
  const [confirming, setConfirming] = useState(false);
  const changing = useIsMutating({ mutationKey: CHANGE }) > 0;
  const disconnect = useMutation({
    mutationKey: CHANGE,
    mutationFn: () => api<GithubStatus>("DELETE", "/api/github"),
    onSuccess: (data) => {
      setConfirming(false);
      return onDisconnected({ contents: data.contents, images: data.images });
    },
  });
  return (
    <section className="card" aria-labelledby="connection-heading">
      <h2 id="connection-heading">Connection</h2>
      <p data-field="github-login">
        Connected as <strong>@{contents.login}</strong>
      </p>
      <TokenState token={contents} replace="reconnect" />
      {confirming ? (
        <div role="alertdialog" aria-labelledby="disconnect-confirm" className="confirm">
          <p id="disconnect-confirm">
            Disconnect GitHub? Your Space forgets its tokens, the image token too, and your apps keep running. Your Space
            can't delete the tokens at GitHub; you do that in your GitHub settings.
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

/**
 * A token pasted into a field and sent to `path`. The token waits here only until the request takes
 * it: it isn't the mutation's variables, which TanStack Query keeps in its cache after the request.
 * The field is cleared, whatever GitHub answers.
 */
function useTokenForm<T>(path: string, onSent: (data: T) => Promise<void> | void) {
  const [token, setToken] = useState("");
  const sending = useRef("");
  const changing = useIsMutating({ mutationKey: CHANGE }) > 0;
  const send = useMutation({
    mutationKey: CHANGE,
    mutationFn: () => {
      const value = sending.current;
      sending.current = "";
      return api<T>("PUT", path, { token: value });
    },
    onSuccess: onSent,
  });
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    sending.current = token;
    send.mutate();
    setToken("");
  };
  return { token, setToken, send, changing, onSubmit };
}

function TokenField({ token, setToken }: { token: string; setToken: (token: string) => void }) {
  return (
    <label>
      Token
      <input type="password" autoComplete="off" spellCheck={false} required value={token} onChange={(event) => setToken(event.target.value)} />
    </label>
  );
}

function TokenState({ token, replace }: { token: Extract<TokenStatus, { set: true }>; replace: string }) {
  const worked = <time dateTime={token.lastWorkedAt}>{when(token.lastWorkedAt)}</time>;
  if (token.problem === "refused") {
    return (
      <p className="notice error" role="alert">
        GitHub no longer accepts this token: it expired, or it was deleted or revoked. Create a new one and {replace}.
      </p>
    );
  }
  if (token.problem === "unreadable") {
    return (
      <p className="notice error" role="alert">
        Your Space can't read the stored token, as when its data key was replaced without the one before it. Create a new
        token and {replace}.
      </p>
    );
  }
  if (token.problem === "unreachable") return <p className="muted">GitHub can't be asked about the token right now. It last worked {worked}.</p>;
  return <p className="muted">GitHub accepts the token. It last worked {worked}.</p>;
}

function Connect({ reconnect, onConnected }: { reconnect: boolean; onConnected: (data: Partial<GithubStatus>) => Promise<void> }) {
  const { token, setToken, send: connect, changing, onSubmit } = useTokenForm<Partial<GithubStatus>>("/api/github", onConnected);
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
        <TokenField token={token} setToken={setToken} />
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

/**
 * The image token (decision 4): optional, for private images on GitHub's container registry, which
 * takes only a classic token. Shown as Images: @login, with Replace and Remove, or else as a short
 * line whose steps open on request.
 */
function Images({ images, onChanged }: { images: TokenStatus; onChanged: (data: Partial<GithubStatus>) => Promise<void> }) {
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [removed, setRemoved] = useState(false);
  const form = useTokenForm<Pick<GithubStatus, "images">>("/api/github/image-token", (data) => {
    setAdding(false);
    setRemoved(false);
    return onChanged(data);
  });
  const remove = useMutation({
    mutationKey: CHANGE,
    mutationFn: () => api<Pick<GithubStatus, "images">>("DELETE", "/api/github/image-token"),
    onSuccess: (data) => {
      setConfirming(false);
      setRemoved(true);
      return onChanged({ images: data.images });
    },
  });
  const steps = (
    <>
      <ol>
        <li>
          <a className="button secondary-link" href={NEW_IMAGE_TOKEN_URL} target="_blank" rel="noreferrer">
            Create an image token on GitHub
          </a>{" "}
          GitHub opens its new classic token page.
        </li>
        <li>Choose only the read:packages scope, and nothing else: Your Space refuses a token with more.</li>
        <li>Choose when it expires, then generate the token and copy it.</li>
        <li>If the images belong to an organization with SAML single sign-on, authorize the token for it at GitHub.</li>
      </ol>
      <details>
        <summary>What the image token can read</summary>
        <p className="muted">
          A classic token's scopes aren't limited to chosen repositories, so read:packages reads every package your
          account can see. An organization can stop classic tokens from reaching its packages, and one with SAML single
          sign-on reads them only once you authorize the token for it. Your Space uses it only to pull private images from
          GitHub's container registry while you review or install an app, and never gives it to apps or agents.
        </p>
      </details>
      <form onSubmit={form.onSubmit}>
        <TokenField token={form.token} setToken={form.setToken} />
        <div className="actions">
          <button type="submit" disabled={form.changing}>
            {form.send.isPending ? "Saving…" : images.set ? "Replace image token" : "Add image token"}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              // A token the owner chose not to send isn't kept, and neither is an earlier refusal.
              form.setToken("");
              form.send.reset();
              setAdding(false);
            }}
          >
            Cancel
          </button>
        </div>
      </form>
    </>
  );
  return (
    <section className="card" aria-labelledby="images-heading">
      <h2 id="images-heading">Images</h2>
      {removed && !images.set ? (
        <p className="notice" role="status">
          Removed the image token. Delete it at GitHub too, in{" "}
          <a href={CLASSIC_TOKENS_URL} target="_blank" rel="noreferrer">
            your classic tokens
          </a>
          .
        </p>
      ) : null}
      {images.set ? (
        <>
          <p data-field="github-images">
            Images: <strong>@{images.login}</strong>
          </p>
          <TokenState token={images} replace="replace the image token" />
        </>
      ) : (
        <p className="muted">
          Optional: an image token, a classic token with only read:packages, lets Your Space pull private images from
          GitHub's container registry, ghcr.io. Other registries' images install only when they're public.
        </p>
      )}
      {adding ? (
        steps
      ) : confirming ? (
        <div role="alertdialog" aria-labelledby="remove-image-token-confirm" className="confirm">
          <p id="remove-image-token-confirm">
            Remove the image token? Your Space forgets it, and your apps keep running. Delete it at GitHub too.
          </p>
          <div className="actions">
            <button type="button" className="danger" onClick={() => remove.mutate()} disabled={form.changing}>
              Remove
            </button>
            <button type="button" className="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="actions">
          <button type="button" className="secondary" onClick={() => setAdding(true)} disabled={form.changing}>
            {images.set ? "Replace" : "Add an image token"}
          </button>
          {images.set ? (
            <button type="button" className="secondary danger-outline" onClick={() => setConfirming(true)} disabled={form.changing}>
              Remove
            </button>
          ) : null}
        </div>
      )}
      {form.send.isError ? (
        <p className="notice error" role="alert">
          {errorMessage(form.send.error)}
        </p>
      ) : null}
      {remove.isError ? (
        <p className="notice error" role="alert">
          {errorMessage(remove.error)}
        </p>
      ) : null}
    </section>
  );
}
