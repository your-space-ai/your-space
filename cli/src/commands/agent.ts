import type { Command } from "commander";
import { CliError } from "../errors.ts";
import type { Ui } from "../ui.ts";

function endpoint(env: NodeJS.ProcessEnv): { origin: string; credential: string } {
  let url: URL;
  try { url = new URL(env.YOUR_SPACE_URL ?? ""); }
  catch { throw new CliError("usage", "Set YOUR_SPACE_URL to the workspace address."); }
  const local = ["localhost", "space.localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
      !(url.protocol === "https:" || (url.protocol === "http:" && local)))
    throw new CliError("usage", "Use the workspace HTTPS origin, or HTTP on localhost.");
  if (!env.YOUR_SPACE_AGENT_KEY) throw new CliError("usage", "Supply YOUR_SPACE_AGENT_KEY in the agent environment.");
  return { origin: url.origin, credential: env.YOUR_SPACE_AGENT_KEY };
}

async function readBody(): Promise<unknown> {
  if (process.stdin.isTTY) throw new CliError("usage", "Pipe the JSON body on stdin.");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 60 * 1024) throw new CliError("invalid_input", "The body exceeds 60 KiB.");
    chunks.push(Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { /* Invalid input never appears in diagnostics. */ }
  throw new CliError("invalid_input", "The body must be JSON.");
}

async function callAgent(ui: Ui, path: string, input?: Record<string, unknown>): Promise<void> {
  const { origin, credential } = endpoint(process.env);
  let response: Response;
  let value: Record<string, unknown>;
  try {
    response = await fetch(origin + path, {
      method: input ? "POST" : "GET", redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${credential}`, ...(input ? { "Content-Type": "application/json" } : {}) },
      body: input ? JSON.stringify(input) : undefined,
    });
    const reader = response.body?.getReader();
    if (!reader) throw new Error();
    const chunks: Buffer[] = [];
    let size = 0;
    for (;;) {
      const { done, value: part } = await reader.read();
      if (done) break;
      size += part.length;
      if (size > 512 * 1024) { await reader.cancel(); throw new Error(); }
      chunks.push(Buffer.from(part));
    }
    const raw = Buffer.concat(chunks).toString("utf8");
    if (raw.includes(credential)) throw new Error();
    value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
  } catch {
    throw new CliError("gateway_unavailable", "The gateway returned no usable response. Try again.");
  }
  if (!response.ok) {
    const reason = typeof value.error === "string" && /^[a-z][a-z_]{0,63}$/.test(value.error) ? value.error : "gateway_error";
    const receipt = typeof value.id === "string" && /^[a-f0-9-]{36}$/.test(value.id) ? { requestId: value.id } : {};
    const status = typeof value.status === "string" && /^[a-z_]{1,32}$/.test(value.status) ? { status: value.status } : {};
    throw new CliError("agent_request_failed", "Check the gateway outcome before retrying.", { reason, httpStatus: response.status, ...receipt, ...status });
  }
  ui.result(value, () => ui.note(JSON.stringify(value, null, 2), "Agent gateway"));
}

export function registerAgentCommands(program: Command, ui: () => Ui): void {
  const agent = program.command("agent").description("use installed apps with an agent credential");
  agent.command("apps").description("list the apps this agent can reach, and the routes that ask first")
    .action(() => callAgent(ui(), "/api/agent/apps"));
  agent.command("request <id>").description("check a call that waited for approval").action((id: string) =>
    callAgent(ui(), "/api/agent/requests/" + encodeURIComponent(id)));
  // Agent access is per app (spec 018): a call is a method and a path under the app's API, with a body.
  agent.command("call <installation-id> <method> <path>").description("call an app's API, such as GET /rest/companies?limit=5")
    .option("--body-stdin", "read the JSON body from stdin")
    .action(async (installationId: string, method: string, path: string, options: { bodyStdin?: boolean }) => {
      const body = options.bodyStdin ? await readBody() : undefined;
      await callAgent(ui(), "/api/agent/call", { installationId, method: method.toUpperCase(), path, ...(body === undefined ? {} : { body }) });
    });
}
