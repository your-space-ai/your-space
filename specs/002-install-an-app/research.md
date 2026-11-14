# Research: Install an App and Use It

**Feature**: [002 Install an App and Use It](spec.md)

Research done on 2026-11-12. Public repositories were read from shallow clones of their default
branches on that date; the cited paths are relative to those clones. Some web pages could not be
fetched from the research environment (docs.docker.com, docs.k3s.io, truenas.com and its forums,
docs.cloudron.io); claims that rest on search summaries instead are marked *(search)* and should be
checked again before anyone relies on them.

## R1. How Your Space Runs App Containers

- **Decision:** a runtime manager in Your Space's own Compose stack alone holds the Docker engine
  connection, and runs only files whose fully resolved form passes an allowlist. Each app gets its
  own sealed network, outbound access goes through an allowlisting proxy, and memory and CPU limits
  are set per app. The engine connection is a concept: a local socket, `ssh://` or `tcp://` with TLS,
  found without configuration, so the engine can run on the host, in a virtual machine Your Space
  provides, or elsewhere, without code that depends on which.
- **The owner's goal:** a local user never thinks about the container setup or sets up permissions;
  a professional on a server can take more control but isn't forced to.

### What existing self-hosted platforms do

| Platform | Runtime | How it controls the runtime | Isolation between apps | Packaging | License |
| --- | --- | --- | --- | --- | --- |
| umbrelOS | Docker Compose | Host daemon runs `docker compose` as root (`umbreld/source/modules/apps/app.ts`) | One shared network for all apps (`legacy-compat/docker-compose.common.yml`); in its store, 15 apps are privileged and 24 use host networking | Rewritten Compose plus `umbrel-app.yml`; Sure is packaged (`umbrel-apps/sure/`) | PolyForm Noncommercial |
| CasaOS | Docker Compose | Root systemd service using the Docker SDK (`pkg/docker/image.go`) | Compose defaults | Upstream-style Compose with `x-casaos` | Apache-2.0 |
| Runtipi | Docker Compose | Platform and Traefik mount `docker.sock:ro`, which doesn't limit the API (`docker-compose.prod.yml`) | Per-app network, but app front-ends share a network with the platform (`compose.builder.ts`) | Its own "dynamic compose" | GPL-3.0 |
| Coolify | Docker Compose | Container SSHes to its own host as root (`scripts/install.sh`) | Network per resource, joined to the proxy | Arbitrary Compose, rewritten; generated `SERVICE_PASSWORD_*` | Apache-2.0 |
| Dokploy | Docker Swarm and Compose | Mounts `docker.sock` | Shared network; optional isolated deployments (`utils/docker/collision.ts`) | Arbitrary Compose | Apache-2.0 (core) |
| TrueNAS SCALE 24.10+ | Docker Compose (k3s before) | Root `middlewared` runs `docker compose` (`plugins/apps/compose_utils.py`) | Catalog defaults `cap_drop: ALL`, `no-new-privileges`, CPU and memory limits | Templates rendering Compose; raw Compose for custom apps | LGPL-3.0 (apps) |
| StartOS 0.4 | LXC (from Docker, then Podman) | Host daemon (`ARCHITECTURE.md`) | One LXC per service | Its own signed packages | MIT |
| Sandstorm | Its own sandbox | Supervisor | Namespaces and seccomp; no network by default (`docs/using/security-practices.md`) | Repackaged apps | Apache-2.0 |

- Nearly every Compose-based platform gives its control plane full root on the host, and none of
  the Docker-based ones limits apps' outbound access or keeps apps off a network shared with the
  platform. Only Sandstorm and StartOS isolate apps by design, and both require repackaging.
- Running an upstream Compose file as-is is rare: polished stores rewrite the file, and the
  raw-Compose paths accept whatever it asks for, including privileged containers.
- Almost none support macOS hosts. Runtipi declines Docker Desktop because its networking differs.
- Gating apps behind the platform's sign-in is proven (Umbrel's app gateway, Runtipi's forward auth,
  YunoHost's SSOwat), and most leave each app's own login in place.

### Kubernetes (k3s) as the runtime

- k3s is small (a binary under 100 MB), Apache-2.0, and runs on x86_64 and ARM (k3s-io/docs
  `introduction.md`). Its own resource profiling measured about 1.6 GB of memory for a server with a
  small workload (`reference/resource-profiling.md`, an older release with a monitoring stack).
- On macOS every option runs a Linux VM (k3d, Docker Desktop's Kubernetes, Rancher Desktop, Colima,
  OrbStack), so k3s adds a layer to the VM a Docker engine already needs, at roughly 1 to 1.5 GB more
  memory. k3d runs k3s in privileged containers (k3d `pkg/runtimes/docker/translate.go`).
- Apps arrive as Compose files. Kompose doesn't convert `depends_on`, so health-gated start order is
  lost, and has no equivalent for `dns`, `network_mode` or internal networks
  (kubernetes/kompose `docs/conversion.md`). Sure's file uses health-gated `depends_on` and `dns`.
- k3s enforces standard NetworkPolicy, which works by IP and port. Approving outbound hosts by name
  still needs Cilium's DNS-aware policies or an egress proxy, and a proxy works the same on Docker.
- TrueNAS SCALE moved from k3s to Docker Compose in 24.10 (Electric Eel), citing simpler
  configuration, lower overhead and contributor reach; users reported idle CPU falling from about
  14% to 3 to 4% *(search)*.
- Conclusion: k3s fits technically on Linux servers, but doesn't meet the goal as a default. It can
  be a later option for professionals behind the engine-connection concept.

### Hardening around Docker

- **Validation must use the fully resolved file.** Tests on Docker Engine 29.9.2 showed `include:`
  pulling in a privileged service with `/:/host`, `extends:` bringing in `pid: host` and
  `cap_add: SYS_ADMIN`, and a "named volume" with `driver_opts` binding the host's `/etc`. So the
  runtime manager checks `docker compose config` output against an allowlist, never the raw YAML.
  Newer Compose keys that reach the host include `use_api_socket`, `provider`, `post_start` hooks
  with `privileged`, `build`, and file-reading keys such as `env_file` and `configs.file`
  (compose-spec `05-services.md`).
- **Socket proxies** (Tecnativa, linuxserver, wollomatic) filter by API path and method; none fully
  checks container-create requests, so they can't make a client that may create containers safe.
  wollomatic's README says so. At most a second layer behind the manager.
- **Docker-in-Docker** needs `--privileged` (docker-library docs `docker/README.md`); a test showed
  the container getting every capability and the host's devices. It adds no protection.
- **Sysbox** gives unprivileged nested containers with user namespaces (nestybox/sysbox), packaged
  for Ubuntu and Debian, supported by Docker on a best-effort basis. **Rootless Docker** and
  **Podman** run the engine as an unprivileged user; rootless Docker silently ignores limits without
  cgroup v2 and systemd (docker-docs `engine/security/rootless/tips.md`). **gVisor** is strong but
  slow for databases and doesn't install on Docker Desktop (google/gvisor
  `g3doc/architecture_guide/performance.md`). **Kata** needs KVM. **Docker Desktop's Enhanced
  Container Isolation** needs a Docker Business subscription. These suit optional hardening for
  servers, not the default.
- **Outbound access:** containers on an `internal` network get no default route or external DNS
  (Engine 25+), but can reach the host's bridge address unless the network uses gateway mode
  `isolated` (Engine 28+). An allowlisting CONNECT proxy on a second network, such as Smokescreen
  (MIT), gives per-app approved hosts; apps that ignore `HTTPS_PROXY` simply fail, the safe default.
  This works inside Docker Desktop's VM as well as on Linux; host firewall rules (`DOCKER-USER`)
  don't.
- **Limits:** `docker compose up` applies `deploy.resources` limits (tested); on Docker Desktop they
  apply inside its VM.

### Not yet verified

- Whether an app on an isolated internal network can reach the Mac host under Docker Desktop or
  another macOS VM. With Your Space's own VM as the macOS default, the host to protect is that VM.
- Docker Desktop's and OrbStack's licence terms, and the TrueNAS details, from search summaries only.

## Docker Desktop Is Not a Dependency

- Docker Engine and Compose are open source (Apache-2.0); Docker Desktop is a separately licensed
  app, free only for personal use, education, non-commercial open source and small businesses
  *(search)*.
- On macOS, Docker Engine needs a Linux VM. Open-source tools provide one with the same engine:
  Colima (MIT), Lima (Apache-2.0), Rancher Desktop (Apache-2.0) and Podman (Apache-2.0).
- So Your Space depends on a Docker-compatible engine, not on Docker Desktop, and on macOS can provide
  its own VM by default (journey 003 or 008 settles how).

## R2. Apps in Panes: Framing, Cookies and App Addresses

- **Test (2026-11-14):** Sure (`ghcr.io/we-promise/sure:stable`, with its own Postgres and Redis)
  behind a Caddy proxy, framed by a stand-in for Your Space that sets a host-only platform cookie
  (`ys_session`). Playwright 1.64 drove Chromium, Firefox and WebKit on Linux. In each setup the
  test signed up to Sure inside the pane, reloaded the page, opened Sure in its own tab, and checked
  whether Sure ever received the platform cookie. The proxy used Caddy's internal CA, and the
  browsers ignored certificate errors.
- **Framing:** Sure sends `X-Frame-Options: SAMEORIGIN` (Rails' default). Without changes every
  browser refused to show it in the pane. With the proxy removing that header and sending
  `Content-Security-Policy: frame-ancestors <Your Space's origin>`, every browser showed it in every
  setup. So framing is solved at the proxy, without changing the app, and the app stays protected
  from being framed by anyone else.
- **Cookies:** where sign-up failed, Sure's log shows "Can't verify CSRF token authenticity": the
  browser didn't send Sure's own `SameSite=Lax` session cookie with the form inside the frame,
  because it treated the frame as a different site.

| Setup | Your Space | App | Chromium | Firefox | WebKit | Platform cookie reaches the app |
| --- | --- | --- | --- | --- | --- | --- |
| Domain, subdomain per app | `https://space.example.com` | `https://sure.space.example.com` | works | works | works | no |
| This machine, subdomain of localhost | `http://localhost:8080` | `http://sure.localhost:8080` | sign-in fails | not measured (the test hung) | sign-in fails | no |
| This machine, named | `http://space.localhost:8080` | `http://sure.space.localhost:8080` | works | works | sign-in fails | no |
| Port per app, one host name | `https://ports.test:9443` | `https://ports.test:9444` | works | works | works | **yes**, in the pane and in its own tab |
| Baseline: no header change | | | refused | refused | refused | |

"Works" means: shown in the pane, sign-up succeeded, still signed in after a reload, and signed in
when opened in its own tab.

- An earlier run with names under `.test` (not on the public suffix list) failed in WebKit for the
  subdomain setup and passed with `example.com`, so whether two names count as the same site depends
  on the public suffix list. Real domains behave like the `example.com` row.
- **Ports share cookies.** Browsers don't separate cookies by port, so an app on another port of
  Your Space's host receives the platform session, and could set cookies with the platform's names.
  A port setup needs the proxy to strip Your Space's cookies from requests to apps and to refuse
  apps' attempts to set them.
- **Not tested:** Safari on macOS (WebKit on Linux differs from Safari in its domain handling),
  Tailscale's own names, real certificates, and Firefox with `sure.localhost`.

### Local setups, a second round (2026-11-14)

| Setup | Chromium | Firefox | WebKit (Linux) |
| --- | --- | --- | --- |
| `localhost` framing `sure.localhost` | sign-in fails | sign-in fails | sign-in fails |
| Same, with the proxy rewriting Sure's cookie to `SameSite=None; Secure; Partitioned` | signs up, but loses the session on reload and in its own tab | same as Chromium | sign-up fails |
| `space.localtest.me` framing `sure.space.localtest.me` (a real ending, simulated with the hosts file) | works | not measured (the test hung) | works |

- **Why `localhost` fails:** with the Public Suffix List's default rule, `localhost` is itself an
  ending, so `sure.localhost` is its own site and bare `localhost` is another; the frame is a third
  party. `space.localhost` and `sure.space.localhost` share the site `space.localhost` in Chromium
  and Firefox (Chromium `net/base/registry_controlled_domains`). WebKit on Linux fails there because
  libsoup can't find a base domain for `.localhost` and compares whole host names
  (`libsoup/cookies/soup-cookie-jar.c`); Safari on macOS uses a different cookie stack and is
  untested.
- **Partitioned cookies are not the answer:** they keep a separate session for the pane and for the
  app's own tab, need `Secure` (which libsoup refuses over plain HTTP), and `SameSite=None` gives up
  the app's own CSRF protection.
- **Public loopback names** (`localtest.me`, `lvh.me`, `nip.io`, `sslip.io`) aren't on the Public
  Suffix List, so every app shares one site and can set cookies for the parent name; they also stop
  resolving offline, and home routers' DNS-rebinding protection often blocks answers that point to
  127.0.0.1 (DDEV documents this for `ddev.site`). Not a default.

### What other products do

| Product | Apps' addresses | Isolation between apps |
| --- | --- | --- |
| GitHub Codespaces, Gitpod | A host name per forwarded port (`NAME-PORT.app.github.dev`, `3000-…gitpod.io`) | Own origin per port |
| Coder | Subdomain apps (`*.coder.example.com`); recommends turning off path-based apps, which share the dashboard's cookie | Strips Coder's own cookies before forwarding to an app (`coderd/workspaceapps`) |
| OrbStack, Traefik's docs | `service.project.orb.local`, `whoami.docker.localhost` | Own host per container |
| JupyterHub | Paths by default; its docs say subdomains are "the only way to reliably isolate user servers from each other" | `__Host-` cookies with subdomains |
| Home Assistant ingress | Paths on one origin, in iframes | None: forwards all cookies; works only because add-ons are curated |
| Umbrel, CasaOS, Runtipi | `host:port` per app | None: ports share one cookie jar |

- The pattern that isolates apps is a host name per app. Ports and paths share cookies.
- Defences that apply with subdomains in every setup: strip Your Space's cookies at the proxy before
  forwarding to an app (as Coder does), make Your Space's session a `__Host-` cookie so apps can't
  overwrite it, and drop any `Domain=` attribute from apps' `Set-Cookie` so an app can't set cookies
  for Your Space or other apps.
