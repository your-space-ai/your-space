// rclone's remote control (journey 014): each synced knowledge base's sync is a container of stock
// `rclone rcd`, which the runtime manager runs (runtime/src/sync.ts) and only the server reaches, on a
// Unix socket in that knowledge base's folder of the ys-sync volume. The server creates the knowledge
// base's remote there and starts each of its bisyncs there (knowledge-sync.ts). rclone answers an error
// with the request it was given, which can hold a remote's token: only its error message is kept, never
// the request.
import { randomBytes } from "node:crypto";
import { request } from "node:http";

/** Where the server mounts the ys-sync volume: each knowledge base's socket is in its folder, `<name>/rc.sock`. */
export const RC_SOCKETS = process.env.YS_SYNC_SOCKETS ?? "/run/ys-sync";
/** How long a call waits for rclone, a listing of a large knowledge base included. */
const CALL_TIMEOUT_MS = 5 * 60_000;
/**
 * How long a call that rclone answers at once waits: one about jobs, remotes or rclone itself. A hung
 * rclone then holds up its own knowledge base's step this long, not five minutes.
 */
const QUICK_TIMEOUT_MS = 30_000;
const QUICK = /^(job|config|core|rc)\//;

export class RcError extends Error {
  /** rclone's HTTP status; 503 when its remote control can't be reached. */
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "RcError";
    this.status = status;
  }
}

/** A job rclone runs in the background (`_async`), as `job/status` describes it. */
export interface RcJob {
  id: number;
  /** rclone's instance: it changes when rclone restarts, which forgets every job. */
  executeId: string;
  group: string;
  finished: boolean;
  success: boolean;
  error: string;
  startTime: string;
  endTime: string;
  /** What the command answers; for a bisync, its log as `output.output`. */
  output?: { output?: unknown } | null;
}

/** What the server needs of rclone's remote control; tests give a fake. */
export interface Rc {
  call<T = Record<string, unknown>>(command: string, params?: Record<string, unknown>): Promise<T>;
  /** Writes a file of `content` at `remote` of the remote or folder `fs` (`operations/uploadfile`). */
  upload(fs: string, remote: string, name: string, content: string): Promise<void>;
}

function post(socketPath: string, path: string, body: Buffer, contentType: string, timeoutMs = CALL_TIMEOUT_MS): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ socketPath, method: "POST", path, headers: { "Content-Type": contentType, "Content-Length": body.length } }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => (text += chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
      res.on("error", reject);
    });
    req.on("error", (error) => reject(error instanceof RcError ? error : new RcError("The knowledge bases' sync service isn't running.", 503)));
    req.setTimeout(timeoutMs, () => req.destroy(new RcError("The knowledge bases' sync service stopped answering.", 504)));
    req.end(body);
  });
}

function answer<T>(command: string, { status, text }: { status: number; text: string }): T {
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new RcError(`rclone answered ${command} with something that isn't JSON.`, 502);
  }
  if (status >= 400) {
    // Only rclone's message: the answer repeats the request, a remote's token included.
    const message = typeof (data as { error?: unknown }).error === "string" ? (data as { error: string }).error : `rclone answered ${status}.`;
    throw new RcError(message.slice(0, 1000), status);
  }
  return data as T;
}

/** A knowledge base's rclone, by the knowledge base's name; tests give fakes. */
export type RcFor = (knowledgeBase: string) => Rc;

/** The remote control of each knowledge base's rclone, on its socket. */
export function socketRcs(dir = RC_SOCKETS): RcFor {
  return (knowledgeBase) => socketRc(`${dir}/${knowledgeBase}/rc.sock`);
}

export function socketRc(socketPath: string): Rc {
  return {
    async call<T>(command: string, params: Record<string, unknown> = {}) {
      return answer<T>(command, await post(socketPath, `/${command}`, Buffer.from(JSON.stringify(params)), "application/json", QUICK.test(command) ? QUICK_TIMEOUT_MS : CALL_TIMEOUT_MS));
    },
    async upload(fs, remote, name, content) {
      const boundary = `ys-${randomBytes(12).toString("hex")}`;
      const body = Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file0"; filename="${name.replace(/["\r\n]/g, "")}"\r\nContent-Type: application/octet-stream\r\n\r\n${content}\r\n--${boundary}--\r\n`,
      );
      const query = new URLSearchParams({ fs, remote });
      answer("operations/uploadfile", await post(socketPath, `/operations/uploadfile?${query}`, body, `multipart/form-data; boundary=${boundary}`));
    },
  };
}
