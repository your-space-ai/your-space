import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, errorMessage } from "../apps-api.ts";
import { connectionQuery, repositoryQuery, reposPath } from "../repositories-api.ts";

type Attempt = {
  attemptId: string;
  verificationUri: string;
  userCode: string;
  expiresAt: string;
  intervalSeconds: number;
};
const endpoint = reposPath + "/connection";

export function GitHubConnection({ ownerId }: { ownerId: string }) {
  const client = useQueryClient();
  const options = connectionQuery(ownerId);
  const connection = useQuery(options);
  const [privateRepos, setPrivateRepos] = useState(false);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState("");
  const start = useMutation({
    mutationFn: () => api<Attempt>("POST", endpoint + "/start", { privateRepos }),
    onSuccess: (data) => {
      setError("");
      setAttempt(data);
    },
    onError: (reason) => setError(errorMessage(reason)),
  });
  const disconnect = useMutation({
    mutationFn: () => api("DELETE", endpoint, {}),
    onSuccess: async () => {
      setConfirm(false);
      setError("");
      await client.invalidateQueries({ queryKey: options.queryKey });
      await client.invalidateQueries({ queryKey: repositoryQuery(ownerId).queryKey });
    },
    onError: (reason) => setError(errorMessage(reason)),
  });
  useEffect(() => {
    if (!attempt) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const expires = Date.parse(attempt.expiresAt);
    function schedule(delay: number) {
      timer = setTimeout(() => void poll(), Math.max(1, delay || 5) * 1000);
    }
    async function poll() {
      if (!attempt || !active) return;
      if (!Number.isFinite(expires) || Date.now() >= expires) {
        setAttempt(null);
        setError("The GitHub code expired. Start a new connection.");
        return;
      }
      try {
        const result = await api<{ status: "pending" | "connected"; intervalSeconds?: number }>(
          "POST",
          endpoint + "/poll",
          { attemptId: attempt.attemptId },
        );
        if (!active) return;
        if (result.status === "connected") {
          setAttempt(null);
          await client.invalidateQueries({ queryKey: options.queryKey });
          await client.invalidateQueries({ queryKey: repositoryQuery(ownerId).queryKey });
        } else schedule(result.intervalSeconds ?? attempt.intervalSeconds);
      } catch (reason) {
        if (active) {
          setAttempt(null);
          setError(errorMessage(reason));
        }
      }
    }
    schedule(attempt.intervalSeconds);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [attempt, client, ownerId]);

  return (
    <section className="card">
      <h2>GitHub connection</h2>
      {error ? (
        <p className="notice error" role="alert">
          {error}
        </p>
      ) : null}
      {connection.isError ? (
        <p role="alert">
          {errorMessage(connection.error)}{" "}
          <button type="button" className="secondary" onClick={() => void connection.refetch()}>
            Retry connection
          </button>
        </p>
      ) : !connection.data ? (
        <p role="status">Checking connection…</p>
      ) : connection.data.connected ? (
        <>
          <p>
            Connected as <strong>{connection.data.login}</strong> ·{" "}
            {connection.data.scope === "repo" ? "Public and private repositories" : "Public repositories"}
          </p>
          {!confirm ? (
            <button type="button" className="secondary" onClick={() => setConfirm(true)}>
              Disconnect GitHub
            </button>
          ) : (
            <div className="confirm">
              <p>
                Disconnect this workspace’s GitHub account? Repository operations will require another connection.
              </p>
              <div className="actions">
                <button
                  type="button"
                  className="danger"
                  disabled={disconnect.isPending}
                  onClick={() => disconnect.mutate()}
                >
                  Disconnect
                </button>
                <button type="button" className="secondary" onClick={() => setConfirm(false)}>
                  Keep connection
                </button>
              </div>
            </div>
          )}
        </>
      ) : !connection.data.configured ? (
        <p>
          Enable Device Flow on a GitHub OAuth app, set its public <code>GITHUB_OAUTH_CLIENT_ID</code> on the
          workspace server, and restart the server.
        </p>
      ) : attempt ? (
        <div>
          <p>Enter this one-use code on GitHub and approve the requested access.</p>
          <p>
            <code>{attempt.userCode}</code>
          </p>
          {attempt.verificationUri === "https://github.com/login/device" ? (
            <a className="button" href={attempt.verificationUri} target="_blank" rel="noreferrer">
              Open GitHub
            </a>
          ) : null}
          <p role="status">Waiting for your approval…</p>
          <button type="button" className="secondary" onClick={() => setAttempt(null)}>
            Stop waiting
          </button>
        </div>
      ) : (
        <>
          <p>Connect the account that owns the repositories you want to manage.</p>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={privateRepos}
              onChange={(event) => setPrivateRepos(event.target.checked)}
            />{" "}
            Include private repositories
            <small>
              GitHub will request its full repository scope for this account. Your Space limits agent access to the
              grants you choose.
            </small>
          </label>
          <button type="button" disabled={start.isPending} onClick={() => start.mutate()}>
            Connect GitHub
          </button>
        </>
      )}
    </section>
  );
}
