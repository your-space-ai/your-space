import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { api, errorMessage } from "../apps-api.ts";
import { reposPath, type Repository } from "../repositories-api.ts";

type WorkingFile = { branch: string; path: string; sha?: string; base: string };
export function RepositoryFiles({ repo }: { repo: Repository }) {
  const [branch, setBranch] = useState(repo.defaultBranch);
  const [path, setPath] = useState("");
  const [file, setFile] = useState<WorkingFile | null>(null);
  const [content, setContent] = useState("");
  const [message, setMessage] = useState("");
  const [receipt, setReceipt] = useState("");
  const open = useMutation({
    mutationFn: (location: { branch: string; path: string }) =>
      api<{ content: string; sha: string }>(
        "GET",
        reposPath + "/file?" + new URLSearchParams({ repoId: repo.id, path: location.path, ref: location.branch }),
      ),
    onSuccess: (result, location) => {
      setFile({ ...location, sha: result.sha, base: result.content });
      setContent(result.content);
      setMessage("");
      setReceipt("");
    },
  });
  const save = useMutation({
    mutationFn: (source: WorkingFile) =>
      api<{ sha: string; commit: string }>("PUT", reposPath + "/file", {
        repoId: repo.id,
        path: source.path,
        branch: source.branch,
        content,
        message: message.trim(),
        ...(source.sha ? { sha: source.sha } : {}),
      }),
    onSuccess: (result, source) => {
      setFile({ ...source, sha: result.sha, base: content });
      setMessage("");
      setReceipt(result.commit);
    },
  });
  const ready = !!branch.trim() && !!path.trim();
  const busy = open.isPending || save.isPending;
  function reset() {
    setFile(null);
    setReceipt("");
    open.reset();
    save.reset();
  }
  return (
    <section className="card">
      <h2>Repository files</h2>
      <p className="muted">Open a known text file on a branch, or create a new file at an unused path.</p>
      <form
        className="repo-fields"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) {
            setFile(null);
            save.reset();
            open.mutate({ branch: branch.trim(), path: path.trim() });
          }
        }}
      >
        <label>
          Branch
          <input
            value={branch}
            required
            disabled={busy}
            onChange={(e) => {
              reset();
              setBranch(e.target.value);
            }}
          />
        </label>
        <label>
          File path
          <input
            value={path}
            placeholder="README.md"
            required
            disabled={busy}
            onChange={(e) => {
              reset();
              setPath(e.target.value);
            }}
          />
        </label>
        <div className="actions">
          <button type="submit" className="secondary" disabled={busy || !ready}>
            Open file
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy || !ready}
            onClick={() => {
              reset();
              setFile({ branch: branch.trim(), path: path.trim(), base: "" });
              setContent("");
              setMessage("");
            }}
          >
            New file
          </button>
        </div>
      </form>
      {open.error ? (
        <p className="notice error" role="alert">
          {errorMessage(open.error)}
        </p>
      ) : null}
      {file ? (
        <form
          className="file-editor"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate(file);
          }}
        >
          <label>
            File contents
            <textarea
              value={content}
              spellCheck={false}
              disabled={busy}
              onChange={(event) => setContent(event.target.value)}
              rows={12}
            />
          </label>
          <label>
            Commit message
            <input
              required
              maxLength={240}
              value={message}
              disabled={busy}
              onChange={(event) => setMessage(event.target.value)}
            />
          </label>
          <p className="small muted">
            This writes <code>{file.path}</code> to <strong>{repo.fullName}</strong> on <code>{file.branch}</code>.
          </p>
          <div className="actions">
            <button
              type="submit"
              disabled={busy || !message.trim() || (file.sha !== undefined && file.base === content)}
            >
              Commit changes
            </button>
          </div>
        </form>
      ) : null}
      {save.error ? (
        <p className="notice error" role="alert">
          {errorMessage(save.error)}
        </p>
      ) : null}
      {receipt ? (
        <p role="status">
          Committed <code>{receipt}</code>.
        </p>
      ) : null}
    </section>
  );
}
