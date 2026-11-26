// github connect | status | image-token | disconnect [--image-token] [--json] (journey 015, decision
// 6): the GitHub page's actions, from the server, as `docker compose exec server github status`. A
// token, the contents token or the image token, comes from a hidden prompt on a terminal, or from
// standard input (`docker compose exec -T server github connect < token.txt`), never from the command
// line, where it would reach shell history and process lists. Nothing here prints or logs a token.
import { isStorageError } from "../db/client.ts";
import { ConnectionError, GITHUB_CLASSIC_TOKENS_URL, GITHUB_TOKENS_URL, GithubConnection, type TokenStatus } from "../github-connection.ts";
import { errorFields, log } from "../log.ts";
import { StorageUnavailable } from "../owner/installation.ts";
import { EXIT, formatTime, openForCommand, output, STORAGE_MESSAGE, type Output } from "./output.ts";
import { Cancelled, hiddenPrompt } from "./prompt.ts";

const USAGE = "Usage: github connect | status | image-token | disconnect [--image-token] [--json]";
const CONNECT = "docker compose exec server github connect";
const IMAGE_TOKEN = "docker compose exec server github image-token";
// Arguments are never repeated back: one of them could be a token.
const noTokenArgument = (action: "connect" | "image-token") =>
  `github ${action} doesn't take the token on the command line, where it would reach shell history and process lists. Run docker compose exec server github ${action} and paste it at the prompt, or give it on standard input: docker compose exec -T server github ${action} < token.txt`;
// A fine-grained token is about 100 characters; this bounds a mistaken file on standard input.
const MAX_INPUT = 64 * 1024;

async function readStdin(): Promise<string> {
  let text = "";
  for await (const chunk of process.stdin) {
    text += chunk;
    if (text.length > MAX_INPUT) throw new ConnectionError(400, "token_invalid", "Standard input holds more than a token. Give only the token.");
  }
  return text;
}

function statusLine(token: TokenStatus, as: string, replace: string): string {
  if (!token.set) return "";
  const worked = `it last worked at ${formatTime(new Date(token.lastWorkedAt))}`;
  switch (token.problem) {
    case "refused":
      return `${as}, but GitHub no longer accepts the token. Create a new one and replace it: ${replace}`;
    case "unreadable":
      return `${as}, but no data key here can read the stored token. Replace it: ${replace}`;
    case "unreachable":
      return `${as}. GitHub can't be asked about the token right now; ${worked}.`;
    default:
      return `${as}. GitHub accepts the token; ${worked}.`;
  }
}

function statusLines(contents: TokenStatus, images: TokenStatus): string[] {
  return [
    contents.set ? statusLine(contents, `Connected as @${contents.login}`, CONNECT) : `Not connected to GitHub. Connect with: ${CONNECT}`,
    images.set
      ? statusLine(images, `Images: @${images.login}`, IMAGE_TOKEN)
      : `No image token, for private images on GitHub's container registry. Add one with: ${IMAGE_TOKEN}`,
  ];
}

async function readToken(): Promise<string> {
  return process.stdin.isTTY ? await hiddenPrompt("Paste the GitHub token (it isn't shown), then press Enter: ", MAX_INPUT) : await readStdin();
}

async function run(action: string, imageToken: boolean, connection: GithubConnection, out: Output): Promise<number> {
  if (action === "status") {
    const status = await connection.status();
    out.success({ ok: true, ...status }, statusLines(status.contents, status.images));
    return EXIT.ok;
  }
  if (action === "disconnect" && imageToken) {
    const { removed } = await connection.removeImageToken();
    out.success(
      { ok: true, removed, images: { set: false }, deleteAt: GITHUB_CLASSIC_TOKENS_URL },
      removed
        ? [`Removed the image token. Your Space keeps the contents token, and installed apps keep running. Delete the image token at GitHub too: ${GITHUB_CLASSIC_TOKENS_URL}`]
        : [`There was no image token to remove. If you created one for Your Space, delete it at GitHub: ${GITHUB_CLASSIC_TOKENS_URL}`],
    );
    return EXIT.ok;
  }
  if (action === "disconnect") {
    const { removed } = await connection.disconnect();
    out.success(
      { ok: true, removed, contents: { set: false }, images: { set: false }, deleteAt: GITHUB_TOKENS_URL, deleteImageTokenAt: GITHUB_CLASSIC_TOKENS_URL },
      removed
        ? [
            `Disconnected. Your Space no longer holds a GitHub token, and installed apps keep running. Delete the tokens at GitHub too: the contents token at ${GITHUB_TOKENS_URL}, and an image token at ${GITHUB_CLASSIC_TOKENS_URL}`,
          ]
        : [`Not connected, so there was no token to remove. If you created one for Your Space, delete it at GitHub: ${GITHUB_TOKENS_URL}, or ${GITHUB_CLASSIC_TOKENS_URL} for an image token`],
    );
    return EXIT.ok;
  }
  let token: string;
  try {
    token = await readToken();
  } catch (error) {
    if (!(error instanceof Cancelled)) throw error;
    out.failure({ ok: false, error: "cancelled", message: "Cancelled. Nothing changed." }, "Cancelled. Nothing changed.");
    return EXIT.usage;
  }
  if (action === "image-token") {
    const { images } = await connection.addImageToken(token);
    const login = images.set ? images.login : "";
    out.success(
      { ok: true, images },
      [`Images: @${login}. Your Space keeps the image token encrypted on this server and uses it only to pull private images from GitHub's container registry.`],
    );
    return EXIT.ok;
  }
  const status = await connection.connect(token);
  const login = status.contents.set ? status.contents.login : "";
  out.success({ ok: true, ...status }, [`Connected as @${login}. Your Space keeps the token encrypted on this server.`]);
  return EXIT.ok;
}

async function main(argv: string[]): Promise<number> {
  const json = argv.includes("--json");
  const out = output(json);
  const [action, ...args] = argv.filter((arg) => arg !== "--json");
  if (action === "--help" || action === "-h" || action === "help") {
    out.success({ ok: true, usage: USAGE }, [USAGE]);
    return EXIT.ok;
  }
  const usage = (message: string) => {
    out.failure({ ok: false, error: "usage", message }, message);
    return EXIT.usage;
  };
  if (action === undefined || !["connect", "status", "image-token", "disconnect"].includes(action)) {
    return usage(`Choose connect, status, image-token or disconnect. ${USAGE}`);
  }
  // `disconnect --image-token` removes the image token alone.
  const imageToken = action === "disconnect" && args.includes("--image-token");
  const rest = imageToken ? args.filter((arg) => arg !== "--image-token") : args;
  if (rest.length > 0) {
    return usage(action === "connect" || action === "image-token" ? noTokenArgument(action) : `github ${action} takes no other arguments. ${USAGE}`);
  }

  const opened = openForCommand(out);
  if (!opened) return EXIT.unexpected;
  const { config, database } = opened;
  try {
    return await run(action, imageToken, new GithubConnection(database.db, config.dataKey), out);
  } catch (error) {
    if (error instanceof ConnectionError) {
      out.failure({ ok: false, error: error.code, message: error.message }, error.message);
      return EXIT.notApplicable;
    }
    if (error instanceof StorageUnavailable || isStorageError(error)) {
      out.failure({ ok: false, error: "storage_unavailable", message: STORAGE_MESSAGE }, STORAGE_MESSAGE);
      return EXIT.storage;
    }
    log("error", "github.failed", errorFields(error));
    const message = "Something unexpected went wrong.";
    out.failure({ ok: false, error: "unexpected", message }, message);
    return EXIT.unexpected;
  } finally {
    await database.pool.end().catch(() => {});
  }
}

process.exitCode = await main(process.argv.slice(2));
