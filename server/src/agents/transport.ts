import { request } from "node:http";
import { isIPv4 } from "node:net";
import { installedInterface } from "../apps/runtime-client.ts";

interface DispatchRequest {
  installation: { id: string; name: string; interfaceService: string; interfacePort: number | null };
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: unknown;
}

/** Only the platform server and edge mount this socket. App containers cannot choose an upstream. */
export async function dispatchAppAction(call: DispatchRequest): Promise<{ status: number; body: unknown }> {
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
  const payload =
    call.body === undefined ? undefined : typeof call.body === "string" ? call.body : JSON.stringify(call.body);
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
          resolve({ status, body: null });
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("error", () => reject(new Error("App response interrupted")));
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 256 * 1024) {
            res.destroy();
            reject(new Error("App result exceeds limit"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () => {
          try {
            resolve({ status, body: size ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null });
          } catch {
            reject(new Error("App returned an invalid result"));
          }
        });
      },
    );
    req.on("error", () => reject(new Error("App transport unavailable")));
    req.end(payload);
  });
}
