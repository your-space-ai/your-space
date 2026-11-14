// A background change's progress (FR-012): polls the job every second until it succeeds or fails.
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { errorMessage, jobQuery } from "../apps-api.ts";

export function JobProgress({ jobId, title, onDone }: { jobId: string; title: string; onDone?: (ok: boolean) => void }) {
  const queryClient = useQueryClient();
  const job = useQuery(jobQuery(jobId));
  const state = job.data?.state;
  // The latest callback, called once when the job finishes.
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (state === "succeeded" || state === "failed") {
      void queryClient.invalidateQueries({ queryKey: ["apps"] });
      void queryClient.invalidateQueries({ queryKey: ["engine"] });
      done.current?.(state === "succeeded");
    }
  }, [state, queryClient]);

  if (job.isError) return <p className="notice error" role="alert">{errorMessage(job.error)}</p>;
  const steps = job.data?.steps ?? [];
  return (
    <section className="job" aria-live="polite" data-job-state={state ?? "running"}>
      <h3>{title}</h3>
      <ol className="steps">
        {steps.map((step, index) => (
          <li key={`${step.at}-${index}`}>{step.message}</li>
        ))}
        {steps.length === 0 ? <li className="muted">Starting…</li> : null}
      </ol>
      {state === "running" || !state ? <p className="muted">Working…</p> : null}
      {state === "succeeded" ? <p className="notice">Done.</p> : null}
      {state === "failed" ? (
        <p className="notice error" role="alert">
          {job.data?.error ?? "The change failed."}
        </p>
      ) : null}
    </section>
  );
}
