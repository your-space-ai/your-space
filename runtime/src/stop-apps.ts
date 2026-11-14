// `docker compose exec runtime stop-apps`: stops every app Your Space manages, before Your Space
// itself is stopped (FR-008). Apps start again when Your Space starts.
import { request } from "node:http";
import { SOCKET_PATH } from "./socket.ts";

const req = request({ socketPath: SOCKET_PATH, method: "POST", path: "/stop-all" }, (res) => {
  let body = "";
  res.setEncoding("utf8");
  res.on("data", (c: string) => (body += c));
  res.on("end", () => {
    if (res.statusCode !== 200) {
      console.error(`Stopping the apps failed: ${body}`);
      process.exit(1);
    }
    const { stopped } = JSON.parse(body) as { stopped: string[] };
    console.log(stopped.length ? `Stopped ${stopped.length} app${stopped.length === 1 ? "" : "s"}. Now stop Your Space: docker compose stop` : "No app was running. Now stop Your Space: docker compose stop");
  });
});
req.on("error", () => {
  console.error("The runtime manager isn't running.");
  process.exit(1);
});
req.end();
