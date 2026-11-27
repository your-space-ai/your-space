// Stand-ins for the knowledge bases' rclone remote controls (journey 014), one for each knowledge base,
// as the runtime manager runs a container of `rclone rcd` for each. Each keeps the remotes it is given
// in memory, runs each bisync or copy as a job a test can hold, answers each with the log a test sets,
// and forgets everything when it restarts, as `rclone rcd` does. Like rclone, every call is a job of
// its own while it runs, `job/list` among them. What tests set (holding jobs, their answers, markers,
// listings, failures) is shared by all of them; they record every call.
import { RcError, type Rc, type RcFor, type RcJob } from "../../src/apps/rclone.ts";

type Json = Record<string, unknown>;

export interface JobAnswer {
  success: boolean;
  error: string;
  /** rclone's JSON log lines. */
  lines: Json[];
  /** For a copy: the files it copied, by name. */
  copied: string[];
  /** The last error the job's stats counted, which a job that succeeded can have too. */
  lastError: string;
}

interface Job extends RcJob {
  command: string;
  params: Json;
  answer: Partial<JobAnswer>;
  /** The knowledge base whose rclone runs it, and when it started among all of them. */
  knowledgeBase: string;
  order: number;
}

/** One knowledge base's rclone. */
class FakeRc implements Rc {
  executeId: string;
  private restarts = 1;
  private nextId = 1;
  remotes = new Map<string, { type: string; parameters: Json }>();
  jobs = new Map<number, Job>();
  mostAtOnce = 0;

  private readonly all: FakeRcs;
  readonly knowledgeBase: string;

  constructor(all: FakeRcs, knowledgeBase: string) {
    this.all = all;
    this.knowledgeBase = knowledgeBase;
    this.executeId = `rclone-${knowledgeBase}-1`;
  }

  restart(): void {
    this.executeId = `rclone-${this.knowledgeBase}-${++this.restarts}`;
    this.remotes.clear();
    this.jobs.clear();
    this.nextId = 1;
  }

  running(): Job[] {
    return [...this.jobs.values()].filter((j) => !j.finished);
  }

  end(job: Job): void {
    const answer = job.answer;
    job.finished = true;
    job.success = answer.success ?? true;
    job.error = answer.error ?? (job.success ? "" : "bisync aborted");
    job.endTime = new Date().toISOString();
    job.output = job.command === "sync/bisync" ? { output: (answer.lines ?? [{ level: "info", msg: "Bisync successful" }]).map((l) => JSON.stringify(l)).join("\n") } : {};
  }

  private unreachable(): RcError | undefined {
    return !this.all.reachable || this.all.unreachable.has(this.knowledgeBase) ? new RcError("The knowledge base's sync isn't running.", 503) : undefined;
  }

  async upload(fs: string, remote: string, name: string, content: string): Promise<void> {
    this.all.calls.push({ knowledgeBase: this.knowledgeBase, command: "operations/uploadfile", params: { fs, remote, name, content } });
    const down = this.unreachable();
    if (down) throw down;
    this.all.markers.add(fs);
  }

  async call<T>(command: string, params: Json = {}): Promise<T> {
    const all = this.all;
    all.calls.push({ knowledgeBase: this.knowledgeBase, command, params });
    await all.gates.get(command);
    const down = this.unreachable();
    if (down) throw down;
    const failure = all.failures.get(command);
    if (failure) {
      all.failures.delete(command);
      throw failure;
    }
    const answer = (value: unknown) => value as T;
    switch (command) {
      case "job/list": {
        // The call itself is a job, under way while it answers, as with rclone; it has finished once asked about.
        const own = this.nextId++;
        this.jobs.set(own, { id: own, executeId: this.executeId, group: `job/${own}`, finished: true, success: true, error: "", startTime: "", endTime: "", command, params, answer: {}, knowledgeBase: this.knowledgeBase, order: 0 });
        return answer({ executeId: this.executeId, jobids: [...this.jobs.keys()], runningIds: [...this.running().map((j) => j.id), own] });
      }
      case "config/create":
        this.remotes.set(params.name as string, { type: params.type as string, parameters: params.parameters as Json });
        // rclone asks whether to sign in again for a new token, which is never answered.
        return answer({ State: "*oauth-islocal,teamdrive,,", Option: { Name: "config_refresh_token" }, Error: "", Result: "" });
      case "config/delete":
        this.remotes.delete(params.name as string);
        return answer({});
      case "operations/stat":
        return answer({ item: all.markers.has(params.fs as string) ? { Path: params.remote, Size: 0 } : null });
      case "operations/copyfile":
        all.markers.add(params.dstFs as string);
        return answer({});
      case "operations/list":
        return answer({ list: all.list(params.fs as string, (params.opt ?? {}) as Json) });
      case "operations/purge":
        all.purged.push(`${params.fs as string}/${params.remote as string}`);
        return answer({});
      case "sync/bisync":
      case "sync/copy": {
        const remote = (command === "sync/bisync" ? (params.path1 as string) : (params.dstFs as string)).replace(/:$/, "");
        if (!this.remotes.has(remote)) throw new RcError(`didn't find section in config file ("${remote}")`, 500);
        const queue = command === "sync/bisync" ? all.answers : all.copies;
        const next = (queue.length > 1 ? queue.shift() : queue[0]) ?? {};
        const job: Job = {
          id: this.nextId++,
          executeId: this.executeId,
          group: params._group as string,
          finished: false,
          success: false,
          error: "",
          startTime: new Date().toISOString(),
          endTime: "",
          command,
          params,
          answer: next,
          knowledgeBase: this.knowledgeBase,
          order: all.nextOrder(),
        };
        this.jobs.set(job.id, job);
        this.mostAtOnce = Math.max(this.mostAtOnce, this.running().length);
        if (!all.hold) this.end(job);
        return answer({ jobid: job.id, executeId: this.executeId });
      }
      case "job/status": {
        const job = this.jobs.get(params.jobid as number);
        if (!job) throw new RcError("job not found", 500);
        const { command: _c, params: _p, answer: _a, knowledgeBase: _k, order: _o, ...status } = job;
        return answer({ ...status });
      }
      case "core/transferred": {
        const job = [...this.jobs.values()].find((j) => j.group === params.group);
        return answer({ transferred: (job?.answer.copied ?? []).map((name) => ({ name, what: "transferring", error: "", checked: false, group: params.group })) });
      }
      case "core/stats": {
        const job = [...this.jobs.values()].find((j) => j.group === params.group);
        const lastError = job?.answer.lastError;
        return answer({ errors: lastError ? 1 : 0, ...(lastError ? { lastError } : {}) });
      }
      case "core/stats-delete":
        return answer({});
      default:
        throw new RcError(`couldn't find method "${command}"`, 404);
    }
  }
}

/** Every knowledge base's rclone, which the server gets by name. */
export class FakeRcs {
  private readonly instances = new Map<string, FakeRc>();
  private order = 0;
  calls: { knowledgeBase: string; command: string; params: Json }[] = [];
  /** Whether their sockets answer; `unreachable` names the knowledge bases whose doesn't. */
  reachable = true;
  unreachable = new Set<string>();
  /** What the next bisync jobs answer: the first is used up, the last stays. */
  answers: Partial<JobAnswer>[] = [];
  /** What the next copies answer. */
  copies: Partial<JobAnswer>[] = [];
  /** New jobs stay under way until `finish`. */
  hold = false;
  /** The folders, local or a remote's root, that have Your Space's marker. */
  markers = new Set<string>();
  /** What each folder lists, recursively: the files under it, by path. */
  listings = new Map<string, { Path: string; Size: number }[]>();
  purged: string[] = [];
  /** Calls of these commands wait for their promise, as a remote control that is slow to answer. */
  gates = new Map<string, Promise<void>>();
  /** The next call of each of these commands fails with its error, once. */
  failures = new Map<string, RcError>();

  /** The server's way to each knowledge base's rclone. */
  readonly rcFor: RcFor = (knowledgeBase) => this.of(knowledgeBase);

  of(knowledgeBase: string): FakeRc {
    let rc = this.instances.get(knowledgeBase);
    if (!rc) this.instances.set(knowledgeBase, (rc = new FakeRc(this, knowledgeBase)));
    return rc;
  }

  nextOrder(): number {
    return ++this.order;
  }

  /** Forgets the remotes and jobs of one knowledge base's rclone, or of all, as when their containers restart. */
  restart(knowledgeBase?: string): void {
    for (const rc of this.instances.values()) if (knowledgeBase === undefined || rc.knowledgeBase === knowledgeBase) rc.restart();
  }

  executeIdOf(knowledgeBase: string): string {
    return this.of(knowledgeBase).executeId;
  }

  /** Every remote made, in any of them, by name. */
  get remotes(): Map<string, { type: string; parameters: Json }> {
    return new Map([...this.instances.values()].flatMap((rc) => [...rc.remotes]));
  }

  /** The jobs started with this command, in the order they started. */
  started(command = "sync/bisync"): Job[] {
    return [...this.instances.values()].flatMap((rc) => [...rc.jobs.values()]).filter((j) => j.command === command).sort((a, b) => a.order - b.order);
  }

  running(): Job[] {
    return [...this.instances.values()].flatMap((rc) => rc.running()).sort((a, b) => a.order - b.order);
  }

  /** The most jobs any one knowledge base's rclone ran at once. */
  get mostAtOnce(): number {
    return Math.max(0, ...[...this.instances.values()].map((rc) => rc.mostAtOnce));
  }

  /** Ends every job under way, or those of one knowledge base, with what each was to answer. */
  finish(knowledgeBase?: string): void {
    for (const rc of this.instances.values()) if (knowledgeBase === undefined || rc.knowledgeBase === knowledgeBase) for (const job of rc.running()) rc.end(job);
  }

  /** A listing as rclone answers one: under `fs`, recursively or not, files only or folders only. */
  list(fs: string, opt: Json): { Path: string; Size: number; IsDir: boolean }[] {
    const root = [...this.listings.keys()].filter((key) => fs === key || fs.startsWith(`${key}/`)).sort((a, b) => b.length - a.length)[0];
    if (root === undefined) throw new RcError("error in ListJSON: directory not found", 500);
    const under = fs === root ? "" : `${fs.slice(root.length + 1)}/`;
    const entries = new Map<string, { Path: string; Size: number; IsDir: boolean }>();
    for (const file of this.listings.get(root)!) {
      if (!file.Path.startsWith(under)) continue;
      const path = file.Path.slice(under.length);
      const parts = path.split("/");
      for (let i = 1; i < parts.length; i++) entries.set(parts.slice(0, i).join("/"), { Path: parts.slice(0, i).join("/"), Size: -1, IsDir: true });
      entries.set(path, { Path: path, Size: file.Size, IsDir: false });
    }
    if (under && entries.size === 0) throw new RcError("error in ListJSON: directory not found", 500);
    return [...entries.values()].filter((e) => (opt.recurse || !e.Path.includes("/")) && (!opt.filesOnly || !e.IsDir) && (!opt.dirsOnly || e.IsDir));
  }
}
