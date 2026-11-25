// A stand-in for the knowledge bases' rclone remote control (journey 014): it keeps the remotes it is
// given in memory, runs each bisync or copy as a job a test can hold, answers each with the log a test
// sets, and forgets everything when it restarts, as `rclone rcd` does. It records every call.
import { RcError, type Rc, type RcJob } from "../../src/apps/rclone.ts";

type Json = Record<string, unknown>;

export interface JobAnswer {
  success: boolean;
  error: string;
  /** rclone's JSON log lines. */
  lines: Json[];
  /** For a copy: the files it copied, by name. */
  copied: string[];
}

interface Job extends RcJob {
  command: string;
  params: Json;
  answer: Partial<JobAnswer>;
}

export class FakeRc implements Rc {
  executeId = "rclone-1";
  private restarts = 1;
  private nextId = 1;
  calls: { command: string; params: Json }[] = [];
  remotes = new Map<string, { type: string; parameters: Json }>();
  jobs = new Map<number, Job>();
  /** Whether its socket answers. */
  reachable = true;
  /** What the next bisync jobs answer: the first is used up, the last stays. */
  answers: Partial<JobAnswer>[] = [];
  /** What the next copies answer. */
  copies: Partial<JobAnswer>[] = [];
  /** New jobs stay under way until `finish`. */
  hold = false;
  /** The folders, local or a remote's root, that have Your Space's marker. */
  markers = new Set<string>();
  /** What each folder lists. */
  listings = new Map<string, { Path: string; Size: number }[]>();
  purged: string[] = [];
  /** The most jobs it ran at once. */
  mostAtOnce = 0;

  /** Forgets every remote and job, as rclone does when its container restarts. */
  restart(): void {
    this.executeId = `rclone-${++this.restarts}`;
    this.remotes.clear();
    this.jobs.clear();
    this.nextId = 1;
  }

  /** The jobs started with this command, in order. */
  started(command = "sync/bisync"): Job[] {
    return [...this.jobs.values()].filter((j) => j.command === command);
  }

  running(): Job[] {
    return [...this.jobs.values()].filter((j) => !j.finished);
  }

  /** Ends every job under way, or one, with what it was to answer. */
  finish(id?: number): void {
    for (const job of this.jobs.values()) if (!job.finished && (id === undefined || job.id === id)) this.end(job);
  }

  private end(job: Job): void {
    const answer = job.answer;
    job.finished = true;
    job.success = answer.success ?? true;
    job.error = answer.error ?? (job.success ? "" : "bisync aborted");
    job.endTime = new Date().toISOString();
    job.output = job.command === "sync/bisync" ? { output: (answer.lines ?? [{ level: "info", msg: "Bisync successful" }]).map((l) => JSON.stringify(l)).join("\n") } : {};
  }

  async upload(fs: string, remote: string, name: string, content: string): Promise<void> {
    this.calls.push({ command: "operations/uploadfile", params: { fs, remote, name, content } });
    if (!this.reachable) throw new RcError("The knowledge bases' sync service isn't running.", 503);
    this.markers.add(fs);
  }

  async call<T>(command: string, params: Json = {}): Promise<T> {
    this.calls.push({ command, params });
    if (!this.reachable) throw new RcError("The knowledge bases' sync service isn't running.", 503);
    const answer = (value: unknown) => value as T;
    switch (command) {
      case "job/list":
        return answer({ executeId: this.executeId, jobids: [...this.jobs.keys()], runningIds: this.running().map((j) => j.id) });
      case "config/create":
        this.remotes.set(params.name as string, { type: params.type as string, parameters: params.parameters as Json });
        // rclone asks whether to sign in again for a new token, which is never answered.
        return answer({ State: "*oauth-islocal,teamdrive,,", Option: { Name: "config_refresh_token" }, Error: "", Result: "" });
      case "operations/stat":
        return answer({ item: this.markers.has(params.fs as string) ? { Path: params.remote, Size: 0 } : null });
      case "operations/copyfile":
        this.markers.add(params.dstFs as string);
        return answer({});
      case "operations/list": {
        const list = this.listings.get(params.fs as string);
        if (!list) throw new RcError(`error in ListJSON: directory not found`, 500);
        return answer({ list });
      }
      case "operations/purge":
        this.purged.push(`${params.fs as string}/${params.remote as string}`);
        return answer({});
      case "sync/bisync":
      case "sync/copy": {
        const remote = (command === "sync/bisync" ? (params.path1 as string) : (params.dstFs as string)).replace(/:$/, "");
        if (!this.remotes.has(remote)) throw new RcError(`didn't find section in config file ("${remote}")`, 500);
        const queue = command === "sync/bisync" ? this.answers : this.copies;
        const next = (queue.length > 1 ? queue.shift() : queue[0]) ?? {};
        const job: Job = { id: this.nextId++, executeId: this.executeId, group: params._group as string, finished: false, success: false, error: "", startTime: new Date().toISOString(), endTime: "", command, params, answer: next };
        this.jobs.set(job.id, job);
        this.mostAtOnce = Math.max(this.mostAtOnce, this.running().length);
        if (!this.hold) this.end(job);
        return answer({ jobid: job.id, executeId: this.executeId });
      }
      case "job/status": {
        const job = this.jobs.get(params.jobid as number);
        if (!job) throw new RcError("job not found", 500);
        const { command: _c, params: _p, answer: _a, ...status } = job;
        return answer({ ...status });
      }
      case "core/transferred": {
        const job = [...this.jobs.values()].find((j) => j.group === params.group);
        return answer({ transferred: (job?.answer.copied ?? []).map((name) => ({ name, what: "transferring", error: "", checked: false, group: params.group })) });
      }
      case "core/stats-delete":
        return answer({});
      default:
        throw new RcError(`couldn't find method "${command}"`, 404);
    }
  }
}
