import { Link } from "@tanstack/react-router";
import { useLayoutEffect, useRef } from "react";
import { api, ApiError } from "../apps-api.ts";
import type { HomeCandidate } from "../home-api.ts";
import { Notice } from "../ui/index.ts";

function frameOrigin(home: HomeCandidate) {
  try {
    const url = new URL(home.src);
    if (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      url.origin === home.origin &&
      home.origin !== window.location.origin
    )
      return home.origin;
  } catch {
    /* An invalid saved location returns to the built-in recovery controls. */
  }
  return null;
}

export function HomeFrame({ home, revision }: { home: HomeCandidate; revision: number }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const load = useRef(0);
  const firstDocument = useRef(true);
  const origin = frameOrigin(home);
  useLayoutEffect(() => {
    if (!origin) return;
    let active = true;
    const pending = new Set<string>();
    const receive = async (event: MessageEvent) => {
      const child = frame.current?.contentWindow;
      if (!child || event.source !== child || event.origin !== origin) return;
      const message = event.data;
      if (
        !message ||
        typeof message !== "object" ||
        message.version !== 1 ||
        typeof message.requestId !== "string" ||
        !/^[\w-]{1,64}$/.test(message.requestId)
      )
        return;
      const discovery = message.type === "your-space:home:actions";
      if (!discovery && message.type !== "your-space:home:read") return;
      const given = load.current;
      const reply = (payload: object) => {
        if (active && frame.current?.contentWindow === child && given === load.current) {
          child.postMessage(
            { type: "your-space:home:result", version: 1, requestId: message.requestId, ...payload },
            origin,
          );
        }
      };
      if (pending.has(message.requestId)) return;
      if (pending.size >= 4) {
        reply({ ok: false, error: { code: "busy", message: "Wait for the current requests to finish." } });
        return;
      }
      const scope = { homeId: home.installationId, revision };
      pending.add(message.requestId);
      try {
        if (discovery) {
          const result = await api("POST", "/api/home/actions", scope);
          reply({ ok: true, result });
        } else {
          const input: unknown = message.input ?? {};
          if (
            typeof message.installationId !== "string" ||
            message.installationId.length > 128 ||
            typeof message.actionId !== "string" ||
            message.actionId.length > 128 ||
            !input ||
            typeof input !== "object" ||
            Array.isArray(input) ||
            JSON.stringify(input).length > 16_384
          ) {
            reply({
              ok: false,
              error: { code: "invalid_input", message: "Send a bounded app action and its declared inputs." },
            });
            return;
          }
          const response = await api<{ result: unknown }>("POST", "/api/home/read", {
            ...scope,
            installationId: message.installationId,
            actionId: message.actionId,
            input,
          });
          reply({ ok: true, result: response.result });
        }
      } catch (error) {
        const code = error instanceof ApiError ? error.code : "unavailable";
        reply({ ok: false, error: { code, message: "The workspace could not complete this Home request." } });
      } finally {
        pending.delete(message.requestId);
      }
    };
    window.addEventListener("message", receive);
    frame.current?.contentWindow?.postMessage({ type: "your-space:home:ready", version: 1 }, origin);
    return () => {
      active = false;
      window.removeEventListener("message", receive);
    };
  }, [home.installationId, origin, revision]);

  return (
    <main className="custom-home">
      <header className="pane-bar">
        <strong>{home.title}</strong>
        <span className="spacer" />
        {origin ? (
          <a href={origin} target="_blank" rel="noopener noreferrer">
            Open app in a tab
          </a>
        ) : null}
        <Link to="/home/settings">Home settings</Link>
        <Link to="/home/built-in">Built-in Home</Link>
      </header>
      {origin ? (
        <iframe
          ref={frame}
          src={home.src}
          title={home.title}
          onLoad={() => {
            if (firstDocument.current) firstDocument.current = false;
            else load.current += 1;
            frame.current?.contentWindow?.postMessage({ type: "your-space:home:ready", version: 1 }, origin);
          }}
          sandbox="allow-scripts allow-same-origin allow-forms"
          referrerPolicy="no-referrer"
        />
      ) : (
        <Notice tone="danger" role="alert">
          This app’s address cannot be opened as Home. Choose another Home in settings.
        </Notice>
      )}
    </main>
  );
}
