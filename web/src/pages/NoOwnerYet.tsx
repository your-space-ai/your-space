// Shown until the owner exists (T030). It explains the server command and has no form: reaching
// the server over the network is never enough to create an account (FR-002).
export function NoOwnerYet() {
  return (
    <main className="panel" data-state="no-owner">
      <h1>Your Space has no owner yet</h1>
      <p>
        The owner is created on the server, by whoever runs it. In the folder with <code>compose.yaml</code>, run:
      </p>
      <pre>docker compose exec server create-owner --username you --name "Your Name"</pre>
      <p className="muted">It prints a link where you set your password. Then come back here to sign in.</p>
    </main>
  );
}
