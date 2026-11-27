import { request } from "node:http";
import { isIPv4 } from "node:net";
import { installedInterface } from "../apps/runtime-client.ts";
import { AGENT_RESULT_LIMIT } from "../apps/agent-kit.ts";

interface DispatchRequest {
  installation: { id: string; name: string; interfaceService: string; interfacePort: number | null };
  method: string;
  path: string;
  headers: Record<string, string>;
  /** A write's body, as the JSON text the agent sent. */
  body?: string;
}

/** Only the platform server and edge mount this socket. App containers cannot choose an upstream. */
/**
 * The app's status and its JSON body. `usable` is false for a 2xx whose body is larger than the
 * result limit or isn't JSON: a write it answers was still applied.
 */
export async function dispatchAppAction(
  call: DispatchRequest,
): Promise<{ status: number; body: unknown; usable: boolean }> {
  const { name, interfacePort } = call.installation;
  if (
    !/^[a-z][a-z0-9-]{0,29}$/.test(name) ||
    !Number.isInteger(interfacePort) ||
    !interfacePort ||
    interfacePort < 1 ||
    interfacePort > 65535
  )
    throw new Error("Invalid installation interface");
  if (!call.path.startsWith("/") || call.path.startsWith("//") || /[\\\r\n#]/.test(call.path))
    throw new Error("Invalid installation route");

  const { address } = await installedInterface(
    "ys-" + name,
    call.installation.id,
    call.installation.interfaceService,
    interfacePort,
  );
  if (!isIPv4(address)) throw new Error("Invalid installed interface");
  const payload = call.body;
  return new Promise((resolve, reject) => {
    const signal = AbortSignal.timeout(15_000);
    const req = request(
      {
        socketPath: "/run/ys-agent/edge.sock",
        method: call.method,
        path: call.path,
        signal,
        headers: {
          ...call.headers,
          ...(payload === undefined ? {} : { "content-type": "application/json" }),
          "x-ys-target": `${address}:${interfacePort}`,
        },
      },
      (res) => {
        const status = res.statusCode ?? 502;
        // Never expose provider errors or redirect locations. Redirects are never followed.
        if (status < 200 || status >= 300) {
          res.destroy();
          resolve({ status, body: null, usable: false });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("error", () => reject(new Error("App response interrupted")));
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > AGENT_RESULT_LIMIT) {
            res.destroy();
            resolve({ status, body: null, usable: false });
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          try {
            resolve({ status, body: size ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null, usable: true });
          } catch {
            resolve({ status, body: null, usable: false });
          }
        });
      },
    );
    req.on("error", () => reject(new Error("App transport unavailable")));
    req.end(payload);
  });
}
