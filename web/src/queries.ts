// Server state through TanStack Query (T021). Query functions unwrap Better Auth's `{ data, error }`
// and turn every failure into an AppError, so one error model serves all screens.
import { queryOptions } from "@tanstack/react-query";
import { authClient } from "./auth-client.ts";
import { AppError, failureForStatus } from "./errors.ts";

export interface Status {
  owner: boolean;
}

async function call<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof AppError) throw error;
    // fetch rejects only when the request could not complete.
    throw new AppError("server_unreachable");
  }
}

interface BetterAuthResult<T> {
  data: T | null;
  error: { status: number } | null;
}

function unwrap<T>(result: BetterAuthResult<T>): T | null {
  if (result.error) throw new AppError(failureForStatus(result.error.status));
  return result.data;
}

export const statusQuery = queryOptions({
  queryKey: ["status"],
  queryFn: () =>
    call(async (): Promise<Status> => {
      const response = await fetch("/api/status", { headers: { accept: "application/json" } });
      if (response.status === 503) throw new AppError("storage_unavailable");
      if (!response.ok) throw new AppError(failureForStatus(response.status));
      const body = (await response.json()) as Partial<Status>;
      if (typeof body.owner !== "boolean") throw new AppError("unexpected");
      return { owner: body.owner };
    }),
  retry: false,
});

export const sessionQuery = queryOptions({
  queryKey: ["session"],
  queryFn: () => call(async () => unwrap(await authClient.getSession())),
  retry: false,
});
