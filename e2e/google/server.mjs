// A stand-in for Google's OAuth token endpoint in the browser tests (journey 014): the server
// exchanges the code it gets back from sign-in here, never at Google. The test's browser answers
// the sign-in page itself and returns the code `ok.<code_challenge>`, so this checks the PKCE
// verifier against it, as Google does, and the test client's secret.
import { createHash } from "node:crypto";
import { createServer } from "node:http";

export const CLIENT_ID = "ys-e2e-client.apps.googleusercontent.com";
export const CLIENT_SECRET = "ys-e2e-client-secret";
const DRIVE = "https://www.googleapis.com/auth/drive";

const json = (res, status, body) => res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(body));

createServer(async (req, res) => {
  if (req.method !== "POST" || new URL(req.url, "http://google").pathname !== "/token") return res.writeHead(404).end();
  let text = "";
  for await (const chunk of req) text += chunk;
  const form = new URLSearchParams(text);
  if (form.get("client_id") !== CLIENT_ID || form.get("client_secret") !== CLIENT_SECRET) return json(res, 401, { error: "invalid_client", error_description: "Unauthorized" });
  if (form.get("grant_type") !== "authorization_code" || !form.get("redirect_uri")?.endsWith("/api/google-drive/callback")) return json(res, 400, { error: "invalid_request" });
  const code = form.get("code") ?? "";
  const challenge = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
  if (code !== `ok.${challenge}`) return json(res, 400, { error: "invalid_grant", error_description: "Bad Request" });
  json(res, 200, { access_token: "ya29.e2e-access-token", expires_in: 3599, refresh_token: "1//e2e-refresh-token", scope: DRIVE, token_type: "Bearer" });
}).listen(8080);
