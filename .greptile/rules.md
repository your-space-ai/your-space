# Review rules for Your Space

- **Code lands with its first use.** A file, top-level function or component, script or config
  entry belongs in a pull request only if something in that pull request runs it: code that runs,
  a test, CI or the deployment, or a developer who first needs it to run, develop or test the app.
- **No dependency the plan doesn't list.** A new package needs a decision and a plan change first.
- **Configuration is optional.** Every setting has a safe default; secrets are generated unless
  `.env` sets them; nothing reachable from the network opens without an explicit choice.
- **Never treat unreadable storage as "no owner yet".** A database outage is reported as storage
  unavailable, never as an empty or unclaimed installation.
- **Nothing sensitive in logs or responses:** no passwords, tokens, set-password or reset links,
  cookies, `Authorization` headers or request bodies.
- **Sign-up stays closed.** Only the operator's `create-owner` command can create the owner.
- **Docs state final decisions,** not the history of a pull request.
