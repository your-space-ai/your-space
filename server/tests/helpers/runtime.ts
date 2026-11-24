// A runtime that records what it is asked and reports what a test sets, in place of the runtime
// manager. The check follows the real adapter's shape for a fixture file.
import { RuntimeError, type ApplyEvent, type AppSpec, type CheckAnswer, type Runtime, type ServiceState } from "../../src/apps/runtime-client.ts";

export class FakeRuntime implements Runtime {
  calls: { method: string; spec?: AppSpec; project?: string; publish?: { port: number; bind: string } }[] = [];
  /** Per project: the services the runtime reports. */
  running = new Map<string, ServiceState[]>();
  denied = new Map<string, { host: string; attempts: number; lastSeen: string }[]>();
  variables: CheckAnswer["variables"] = [
    { name: "GREETING", required: false, default: "hello" },
    { name: "API_TOKEN", required: false, default: "published-default-token" },
  ];
  failApply: string | undefined;
  /** Per port of this machine: what uses it, as the port check names it, or undefined for a program. */
  portsInUse = new Map<number, string | undefined>();
  /** A port check that can't run, for example without Your Space's Caddy. */
  failPortCheck: string | undefined;
  /** What a check refuses, for the spec it is given. */
  refuse: (spec: AppSpec) => CheckAnswer["refusals"] = () => [];

  stopping = false;

  async engine() {
    return { stopping: this.stopping, reachable: true, version: "29.0.0", os: "linux", arch: "amd64", cpus: 4, memory: 8 * 1024 ** 3, connection: "unix:///var/run/docker.sock" };
  }

  async check(spec: AppSpec): Promise<CheckAnswer> {
    this.calls.push({ method: "check", spec });
    // Like Compose, a setting the file requires refuses the file without a value, unless the check gives it a placeholder.
    const missing = this.variables.find((v) => v.required && !spec.env[v.name]);
    if (missing && !spec.placeholders) {
      throw new RuntimeError(`The file isn't a Compose file Your Space can read: required variable ${missing.name} is missing a value`, 400, "refused");
    }
    const refusals = this.refuse(spec);
    return {
      ok: refusals.length === 0,
      services: [
        { name: "web", image: "traefik/whoami:latest", interface: spec.interface?.service === "web", ports: [80], published: [{ target: 80, host: 8000 }], volumes: [], dependsOn: [] },
      ],
      variables: this.variables,
      adaptations: [{ service: "web", kind: "changed", detail: "Published ports removed: Your Space routes to the app's interface itself." }],
      refusals,
      images: [
        { ref: "traefik/whoami:latest", digest: "sha256:aaa", runsHere: true, platforms: ["linux/amd64"] },
        { ref: "ubuntu/squid:latest", digest: "sha256:bbb", runsHere: true, platforms: ["linux/amd64"] },
      ],
    };
  }

  async apply(spec: AppSpec, onEvent: (event: ApplyEvent) => void) {
    this.calls.push({ method: "apply", spec });
    onEvent({ step: "check" });
    if (this.failApply) throw new Error(this.failApply);
    // An apply never gives a required setting a placeholder.
    const missing = this.variables.find((v) => v.required && !spec.env[v.name]);
    if (missing) throw new Error(`The file isn't a Compose file Your Space can read: required variable ${missing.name} is missing a value`);
    onEvent({ step: "start" });
    this.running.set(spec.project, [
      { name: "web", role: "app", state: "running" },
      { name: "ys-egress", role: "egress", state: "running" },
      // A Caddy that lets Your Space frame the app reports a new ID each time it is recreated.
      ...(spec.publish
        ? [{ name: "ys-publish", role: "publish" as const, state: "running", ...(spec.publish.frame ? { framing: String(this.calls.length).padStart(12, "0") } : {}) }]
        : []),
    ]);
    onEvent({ step: "started" });
  }


  async down(project: string) {
    this.calls.push({ method: "down", project });
    this.running.delete(project);
  }

  async deleteVolumes(project: string) {
    this.calls.push({ method: "deleteVolumes", project });
  }

  async apps() {
    return [...this.running].map(([project, services]) => ({ project, app: project.slice(3), services }));
  }

  async logs(project: string, service: string) {
    return [`${project} ${service} started`];
  }

  async stats(project: string) {
    return { services: (this.running.get(project) ?? []).map((s) => ({ name: s.name, memory: 10 * 1024 ** 2, memoryLimit: 64 * 1024 ** 2, cpuPercent: 1 })) };
  }

  async denials(project: string) {
    return { hosts: this.denied.get(project) ?? [] };
  }

  async checkPort(project: string, publish: { port: number; bind: string }) {
    this.calls.push({ method: "checkPort", project, publish });
    if (this.failPortCheck) throw new RuntimeError(this.failPortCheck, 502, "engine_error");
    if (!this.portsInUse.has(publish.port)) return { inUse: false };
    const by = this.portsInUse.get(publish.port);
    return by ? { inUse: true, by } : { inUse: true };
  }
}

/** The commit every stand-in repository's `main` is at. */
export const COMMIT = "0123456789abcdef0123456789abcdef01234567";
/** An older commit, which a kit can pin its Compose file to (`owner/repo@PINNED/path` in `fakeGithub`). */
export const PINNED = "fedcba9876543210fedcba9876543210fedcba98";

/** The link to an app's kit in the stand-in kits repository that `plainKit` fills. */
export function kitLink(name: string): string {
  return `https://github.com/ys-fixtures/catalog/blob/main/apps/ys-fixtures/${name}.yaml`;
}

/**
 * A kit for ys-fixtures/<name>'s compose.yaml at `main`'s commit, for `fakeGithub`: every app installs
 * with one. Its interface is the fixture's web service; `more` adds kit fields.
 */
export function plainKit(name: string, more = ""): Record<string, string> {
  return {
    [`ys-fixtures/catalog/apps/ys-fixtures/${name}.yaml`]: `kit: 1\nsource: { repo: ys-fixtures/${name}, path: compose.yaml, commit: ${COMMIT} }\ninterface: { service: web, port: 80 }\n${more}`,
  };
}

/**
 * A stand-in for GitHub. A file keyed `owner/repo/path` is at `COMMIT`, which `main` resolves to; one
 * keyed `owner/repo@<commit>/path` is only at that commit.
 */
export function fakeGithub(files: Record<string, string>): typeof fetch {
  const at = (key: string) => {
    const [, repo, commit, path] = /^([^/@]+\/[^/@]+)(?:@([0-9a-f]{40}))?\/(.+)$/.exec(key)!;
    return { repo: repo!, commit: commit ?? COMMIT, path: path! };
  };
  const stored = Object.entries(files).map(([key, text]) => ({ ...at(key), text }));
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (url.hostname === "api.github.test" && parts[0] === "repos" && parts[3] === "commits") {
      if (parts.length === 4 && url.searchParams.get("per_page") === "1")
        return Response.json([{ sha: COMMIT }]);
      const ref = parts.slice(4).join("/");
      const repo = `${parts[1]}/${parts[2]}`;
      const commits = new Set(stored.filter((f) => f.repo === repo).map((f) => f.commit));
      if (commits.size && (ref === "main" || ref === "feature/x")) return new Response(COMMIT);
      if (commits.has(ref) || (commits.size && ref === COMMIT)) return new Response(ref);
      return new Response("", { status: 404 });
    }
    if (url.hostname === "raw.github.test") {
      const [owner, repo, commit, ...path] = parts;
      const file = stored.find((f) => f.repo === `${owner}/${repo}` && f.commit === commit && f.path === path.join("/"));
      if (file) return new Response(file.text);
      return new Response("", { status: 404 });
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
}
