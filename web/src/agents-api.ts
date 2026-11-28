// Public metadata from the owner API. Clear credential values appear only in issue/rotate responses.
import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { errorMessage } from "./apps-api.ts";

/** A route that asks the owner first: a method and a path, `*` standing for one segment (spec 018). */
export interface AskRule {
  method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  path: string;
}

export interface AgentInstallation {
  id: string;
  name: string;
  title?: string;
  source: string | null;
  /** Why agents can't reach the app: its stored kit is in the format before agent access per app. */
  problem: "old_format" | null;
  /** The path the app's API lives under. */
  api: string | null;
  /** The kit names its credentials. */
  named: boolean;
  credentials: { name: string; bound: boolean }[];
  revision: number;
}

export interface AgentGrant {
  installationId: string;
  /** The bound credential this agent uses; none until the owner picks one. */
  credential: string | null;
  asks: AskRule[];
  revision: number;
}

export interface Agent {
  id: string;
  name: string;
  disabled: boolean;
  keys: { id: string; revoked: boolean }[];
  grants: AgentGrant[];
}

export interface ApprovalRequest {
  id: string;
  agentId: string;
  installationId: string;
  actionId: string;
  status: string;
  input: unknown;
  revision: number;
  credentialId?: string;
  expiresAt?: string;
}

export interface ActivityEntry {
  id: string;
  agentId: string;
  installationId: string;
  actionId: string;
  status: string;
  createdAt: string;
  ownerId: string;
}

export interface AgentDashboard {
  agents: Agent[];
  installations: AgentInstallation[];
  requests: ApprovalRequest[];
}

export const agentPath = "/api/agents";

/** Keep secrets and approval payloads out of the global mutation cache. Block double submission. */
export function useAgentAction() {
  const client = useQueryClient();
  const lock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function run(work: () => Promise<void>, success: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
      setMessage(success);
      await client.invalidateQueries({ queryKey: ["agents"] });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      lock.current = false;
    }
  }
  return { run, busy, error, message };
}
