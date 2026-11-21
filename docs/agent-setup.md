# Set up a personal workspace from an operator shell

An owner can authorize a local operator or coding assistant to set up Your Space on their Mac or Linux machine. Run the following commands in that machine's shell. This procedure needs Docker access on the machine that will run the workspace. An agent key for an existing workspace cannot perform initial setup.

## Get the CLI and Docker

1. Select a [Your Space release](https://github.com/your-space-ai/your-space/releases) that includes the setup command, its matching install files and the server images. For Linux, follow the [standalone CLI checksum and installation steps](install/README.md#1-get-the-your-space-command) for the correct processor. On a Mac with Node installed, use the exact matching version of the project's npm package when the release lists it, for example `npm install --global your-space@<version>`. Verify with `your-space --version`. If no matching release is available, use the candidate procedure below.
2. Run `your-space engine check --json`. It checks the selected local Docker engine and Docker Compose. On Linux use a supported Docker Engine and the Compose plugin. On a Mac use a running Docker-compatible engine such as Colima, OrbStack or Docker Desktop with its CLI. Start an installed engine or let the operator install their preferred one, then repeat the check. Fix a local permission problem through the operator. The setup command never installs Docker, obtains administrator access, or changes the system's Docker context. See [requirements and installation](install/README.md#before-you-start).
3. Choose a new private folder outside any source repository. For example, run the following from the operator's account.

```sh
your-space setup --workdir "$HOME/my-your-space" --json
```

The command checks the versioned release files, starts Docker Compose on loopback, creates the first owner and returns one JSON object. By default the owner's display name is `Owner` and their username is `owner`. To choose them, pass `--owner-name "My Name" --owner-username myname` on the first run. To use another loopback port, pass `--port 8081` before initializing the folder. The owner can later configure a server address or proxy using the [installation guide](install/README.md).

On success, return the `workspaceUrl` and, when present, the `handoffFile` path to the owner. The owner opens that private local file and follows its single-use link to set their own password. Leave the file’s contents out of chat, terminal transcripts and logs. The command creates the file with mode 0600 and only after a successful server-side owner creation. The link expires after 30 minutes. The operator can remove the file after the owner finishes.

## Resume and manage

Re-run the same command and workdir after resolving a missing engine, unavailable images or a startup failure. It reuses the installation and keeps the existing owner, credentials and data. An existing installation with no handoff file returns `owner: "present"` and `handoffFile: null`. It can also return the path to the original file after the link was used or expired. Setup never renews or consumes that link. If a handoff expired or file storage failed during creation, the authorized owner can use [operator recovery](install/README.md#recover-the-owner-account) in a private terminal.

For routine operations, use `your-space status --workdir <folder> --json`, `your-space logs --workdir <folder>`, `your-space stop --workdir <folder>` and `your-space start --workdir <folder> --no-open`. Keep the installation folder, named volumes and generated secrets. To change an already initialized port, use `your-space configure --workdir <folder> --this-machine --port <port>`. Establish agent identities and grants separately after owner sign-in.

## Test from reviewed source

For a private candidate without published artifacts, build the CLI with `npm ci` then `npm run build -w cli` from the source checkout. Run `deploy/release-files.sh <cli-version> <release-folder>`. Generate `SHA256SUMS` in that folder with `shasum -a 256 your-space.tar.gz > SHA256SUMS` on macOS or `sha256sum your-space.tar.gz > SHA256SUMS` on Linux. Make the matching candidate images available to the local engine. Invoke `node cli/dist/your-space.cjs setup --release-dir <release-folder> --workdir <new-folder> --json`. The local release bundle must pin the same version as the CLI. This tests local candidate files and images. Public downloads require a published matching release.
