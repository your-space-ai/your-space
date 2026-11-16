// A runtime that records what it is asked and reports what a test sets, in place of the runtime
// manager. The check follows the real adapter's shape for a fixture file.
import type { ApplyEvent, AppSpec, CheckAnswer, Runtime, ServiceState } from "../../src/apps/runtime-client.ts";

export class FakeRuntime implements Runtime {
  calls: { method: string; spec?: AppSpec; project?: string }[] = [];
  /** Per project: the services the runtime reports. */
  running = new Map<string, ServiceState[]>();
  variables: CheckAnswer["variables"] = [
    { name: "GREETING", required: false, default: "hello" },
    { name: "API_TOKEN", required: false, default: "published-default-token" },
  ];
  failApply: string | undefined;

  stopping = false;

  async engine() {
    return { stopping: this.stopping, reachable: true, version: "29.0.0", os: "linux", arch: "amd64", cpus: 4, memory: 8 * 1024 ** 3, connection: "unix:///var/run/docker.sock" };
  }

  async check(spec: AppSpec): Promise<CheckAnswer> {
    this.calls.push({ method: "check", spec });
    return {
      ok: true,
      services: [{ name: "web", image: "traefik/whoami:latest", interface: spec.interface?.service === "web", ports: [80], volumes: [], dependsOn: [] }],
      variables: this.variables,
      adaptations: [{ service: "web", kind: "changed", detail: "Published ports removed: Your Space routes to the app's interface itself." }],
      refusals: [],
      images: [
        { ref: "traefik/whoami:latest", digest: "sha256:aaa", runsHere: true, platforms: ["linux/amd64"] },
      ],
    };
  }

  async apply(spec: AppSpec, onEvent: (event: ApplyEvent) => void) {
    this.calls.push({ method: "apply", spec });
    onEvent({ step: "check" });
    if (this.failApply) throw new Error(this.failApply);
    onEvent({ step: "start" });
    this.running.set(spec.project, [{ name: "web", role: "app", state: "running" }]);
    onEvent({ step: "started" });
  }


  async apps() {
    return [...this.running].map(([project, services]) => ({ project, app: project.slice(3), services }));
  }
}

export const COMMIT = "0123456789abcdef0123456789abcdef01234567";

/** GitHub's commits API and raw files for a few fixture repositories. */
export function fakeGithub(files: Record<string, string>): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (url.hostname === "api.github.test" && parts[0] === "repos" && parts[3] === "commits") {
      const ref = parts.slice(4).join("/");
      const repo = `${parts[1]}/${parts[2]}`;
      const known = Object.keys(files).some((k) => k.startsWith(`${repo}/`));
      if (known && (ref === "main" || ref === "feature/x" || ref === COMMIT)) return new Response(COMMIT);
      return new Response("", { status: 404 });
    }
    if (url.hostname === "raw.github.test") {
      const [owner, repo, commit, ...path] = parts;
      const text = files[`${owner}/${repo}/${path.join("/")}`];
      if (commit === COMMIT && text !== undefined) return new Response(text);
      return new Response("", { status: 404 });
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
}
