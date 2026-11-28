# Feature Specification: Approved Host Lookups

**Feature Branch**: `020-approved-host-lookups`

**Created**: 2026-11-27

**Status**: Draft. The direction is agreed: a small DNS responder per app, driven by the app's
approved hosts, that answers only those names and refuses every other one without forwarding it.
Decisions 1 and 2 are open.

**Input**: The owner, on 2026-11-27: an app that looks a host name up before it fetches the URL
can't use any approved host, because its sealed network resolves only container names. The fix
belongs in Your Space, not in the app: "our goal should be to get your space working with any app."
Opening DNS to every name was rejected, because DNS lookups would then carry data out of the app.

**Related**: journey [002](../002-install-an-app/spec.md) and its plan's sealed network and egress
proxy, the 2026-11-14 decisions on the
[app network and approved hosts](../../docs/architecture/decisions.md), and
[Install and publish apps](../../docs/apps/install-apps.md).

## At a Glance

- **Who:** an owner whose app checks a URL's address before fetching it, such as an app that
  refuses feeds or webhooks pointing at private addresses (an anti-SSRF check), or any app that
  resolves a name before it uses the proxy.
- **Done when:** an app on its sealed network can look up each host approved for it and gets the
  host's real public addresses; a lookup of any other name gets "no such name" and leaves the
  machine nowhere; container names resolve as they do today; requests still reach the internet only
  through the app's egress proxy; and approving or removing a host changes what the app can look up
  without restarting the app.
- **Not covered:** wildcard approvals (none exist; approvals are exact names), apps that connect to
  a resolved address directly or ask the proxy for an address rather than a name, and apps that
  ignore proxy settings. They stay as they are today.

## Decisions

| # | Question | Decision or recommendation |
| --- | --- | --- |
| 1 | Where does the responder run? | **Recommended:** in a container of its own, `ys-dns`, beside `ys-egress`, from the official CoreDNS image run unmodified. The agreed direction put it inside `ys-egress`, but that image (`ubuntu/squid`) has no DNS server, so it would mean an image Your Space builds and maintains for both processor types, against the decision to run Squid unmodified. A container sharing `ys-egress`'s network was tried and stopped answering when `ys-egress` was recreated on its own. See [section 1](#1-where-the-responder-runs). |
| 2 | Does a refused lookup become an access request? | **Recommended:** yes, as a refused request through the proxy does. An app that looks a name up first never reaches the proxy with an unapproved host, so without this the owner would never learn which host to approve. See [section 2](#2-refused-lookups-become-access-requests). |

## What Exists Today

- **Sealed network.** Each app is a Compose project whose services are only on its `app` network:
  `internal: true`, in Docker's isolated gateway mode, with an address range Docker picks from its
  pool. It has no route out; a direct connection to a public address fails.
- **Egress proxy.** `ys-egress` runs `ubuntu/squid`, pinned by digest, on `app` and on a normal
  `egress` network. Every app service gets `HTTP_PROXY`, `HTTPS_PROXY` and their lower-case forms
  pointing at it, and `NO_PROXY` for its own services. Its configuration (`egressConfig()` in
  `runtime/src/adapter.ts`) allows the approved host names exactly (`dstdomain` without a leading
  dot), denies private and link-local addresses, and denies everything else. Its access log's
  denials become access requests.
- **DNS.** Each container's `/etc/resolv.conf` points at Docker's embedded resolver, 127.0.0.11,
  which answers container and service names. It doesn't forward other names out of an internal
  network (the CVE-2024-29018 fix), so an app's lookup of an approved host fails with `SERVFAIL`,
  while the same lookup in `ys-egress` works. The machine's search domains are copied into each
  container.
- **Approvals.** Hosts are exact names checked against `HOST` in `server/src/apps/service.ts`; there
  are no wildcards. Approving or removing a host queues an `apply` job. The egress configuration's
  hash is a label on `ys-egress`, so Compose recreates only that container; the app keeps running.
- **Images.** The runtime looks up a digest for `ubuntu/squid:latest` with the app's own images and
  stores it with the app; `up` runs with `--pull never` after the job pulls missing images. A
  finished one-time service is left out of `up` with `--no-deps` and a list of the other services.

## What Was Checked

On Docker Engine 29.1.3 with the runtime's Compose v5.8.0, with throwaway projects shaped like an
app's (an internal network in isolated gateway mode, a normal egress network) (2026-11-27):

| Check | Result |
| --- | --- |
| A service with `dns:` set to an address on its internal network | Its `resolv.conf` still names 127.0.0.11; Docker answers service names itself and forwards other names to that address, from the service's own network |
| A lookup of an approved name, through CoreDNS forwarding it | `NOERROR` with the real CNAME chain and A records; AAAA records too; `getent hosts` works |
| A lookup of an unapproved name, a subdomain of an approved name, its parent, or a TXT lookup of a made-up name | `NXDOMAIN` from CoreDNS, nothing forwarded, each one logged |
| An approved name in other letter cases | Answered |
| A direct query to the responder, past Docker's resolver | The same answers |
| The responder stopped | `SERVFAIL`; nothing resolves outside the app |
| A direct connection from the app to a public address | Still fails |
| `dns_search: .` | No `search` line; the machine's search domains are gone |
| A fixed address for the responder on a network whose range Docker picked | Works with `docker run --ip`; Compose needs the range in the file (`ipam`) |
| Adding `ipam` with the range Docker had picked to an existing app's network | Compose stops the app's containers, recreates the network on the same range, and starts the same containers again; the next `up` changes nothing |
| A range already used by another network | Docker refuses it: "Pool overlaps with other one on this address space" |
| CoreDNS 1.15.0 sharing `ys-egress`'s network (`network_mode: service:`) | Works, and Compose recreates it with `ys-egress`; but recreating `ys-egress` alone leaves it answering on a network that's gone |
| CoreDNS in its own container on `app`, at a fixed address, and on `egress` | Works, and keeps working when `ys-egress` restarts; about 9 MB of memory, as user 65532 with every capability but `NET_BIND_SERVICE` dropped (with none, `exec /coredns: operation not permitted`) |
| The Corefile of section 3 | A, AAAA and either case of an approved name: answered; its TXT and HTTPS: `NOERROR`, empty; a subdomain, an unapproved name, a made-up TXT: `NXDOMAIN` |
| CoreDNS's `view` plugin with `expr name() in ['a.example.com.', …]` | Matches exact names only; double quotes in the expression break the Corefile, single quotes work |

Docker forwards from an internal network to a DNS server inside it since Engine 26.1
([moby#47832](https://github.com/moby/moby/pull/47832)); Your Space requires 28.3.3 or newer. The
check above ran only on Linux; the build runs it on CI's engine and on a Mac engine (FR-011).

An app that refuses private addresses resolves the feed's host, checks the addresses, and then
fetches the URL by name through the proxy, re-checking each redirect the same way. With this
change both lookups answer, and the fetch goes through the proxy as it does today.

## 1. Where the Responder Runs

Each app gets a second Your Space service, `ys-dns`, beside `ys-egress`:

- **Image.** The official CoreDNS image (`coredns/coredns`, a CNCF project, published for amd64,
  arm64 and more), run unmodified, with its digest looked up and stored with the app's images like
  Squid's.
- **Networks.** On `app` at a fixed address, and on `egress`, so it can ask the machine's resolver
  through Docker's embedded resolver on that network. Nothing else runs on `egress` but the two Your
  Space services.
- **Limits.** 32 MB of memory and 0.1 CPU, user 65532 as the image sets, every capability dropped
  but `NET_BIND_SERVICE` (the image's binary carries it as a file capability, and without it in the
  bounding set the binary can't start), `no-new-privileges`, restart `unless-stopped`.
- **Configuration.** A Corefile Your Space writes from the approved hosts, given as an inline
  Compose config, with its hash as a label so Compose recreates `ys-dns` when the hosts change.
  (Compose refuses an inline config in a `read_only` service, so the root stays writable; CoreDNS
  writes nothing.)

Rejected: an `ys-egress` image of Your Space's own with Squid and a DNS server (a second image to
build, sign and update for both processor types, and Squid no longer run unmodified); and a
container sharing `ys-egress`'s network, which is lost whenever `ys-egress` is recreated or started
alone.

## 2. Refused Lookups Become Access Requests

`ys-dns` logs every query it answers. When the runtime reads an app's denied hosts from Squid's log,
it also reads `ys-dns`'s log (`docker logs`) for names it refused, keeps those that pass `HOST`, and
merges both into the app's access requests, with the time and count of tries as today. A host tried
both ways is one request. Dismissing a request stops it from being asked again, as today.

## 3. What the Responder Answers

For an approved host, exactly that name in any letter case:

- **A and AAAA** are forwarded to the resolver Docker gives `ys-dns`, which is the machine's, and
  the answer goes back unchanged: CNAMEs, every address, and the upstream TTL. Nothing is cached in
  `ys-dns`; Squid resolves the name again itself.
- **Any other type** gets an empty answer (`NOERROR`, no records), so a client's HTTPS or TXT lookup
  can't read as "no such name" and the name carries nothing else upstream.

For every other name, including subdomains and parents of an approved host: `NXDOMAIN`, answered
by `ys-dns` itself and never forwarded. An app with no approved hosts gets `NXDOMAIN` for every
outside name, where it gets `SERVFAIL` today.

An approved name that resolves to a private address is answered as it resolves; Squid still denies
the request, as today.

## 4. How Apps Use It

Every app service gets:

- `dns: [<ys-dns's address>]`. Its `resolv.conf` keeps 127.0.0.11, so container and service names
  resolve as today, and Docker forwards every other name to `ys-dns`.
- `dns_search: .`, so the machine's search domains don't reach the app or turn one lookup into
  several refused names.
- `depends_on: ys-dns` with `service_started`. The CoreDNS image has no shell, so it has no Docker
  healthcheck; a lookup in the moment before it listens gets `SERVFAIL` and is retried by the app.

A Compose file's own `dns`, `dns_search` and `dns_opt` stay dropped, as every setting outside
the allowed list is.

## 5. A Fixed Address on the Sealed Network

`dns:` takes an address, not a name, and Compose gives a fixed address only on a network whose range
the file sets. So Your Space sets the `app` network's range:

- **An app whose network exists** keeps the range Docker gave it: the runtime reads it from the
  network at each apply, so nothing new is stored.
- **A new app, or one whose network is gone** (a reinstall that reuses data, a restore), gets a free
  range from Docker: the runtime creates a scratch network, reads the range Docker picked and removes
  it. If another network takes the range before `up`, Docker refuses it and the runtime asks again,
  once.
- **Inside the range**, Docker hands out addresses only from its lower half (`ip_range`), and
  `ys-dns` takes the last usable address, so no container can take it first.

The first apply after an upgrade adds the range to each existing app's network, so Compose stops
the app, recreates the network and starts the app again, once. Your Space already renews every app
when its server starts after an upgrade, so this adds no second restart.

## 6. Approving and Removing Hosts

Unchanged for the owner. The `apply` job writes the new Corefile with the new Squid configuration;
Compose recreates `ys-egress` and `ys-dns`, at the same address, and leaves the app's own containers
running. For a few seconds lookups get `SERVFAIL`. Removing a host stops both its lookups and its
requests at once.

## 7. Everything That Knows About `ys-egress`

`ys-dns` joins it wherever Your Space names its own services: the reserved service names refused in
a Compose file, the container role (`egress`, `publish`, and now `dns`), the services whose logs and
limits the app page shows, the services `up` names when it leaves out a finished one-time service,
and removal.

## User Scenarios

1. **A guarded fetch.** An app that checks a feed's address before fetching it has the feed's host
   approved. The owner adds the feed; the app resolves the host to its public addresses, fetches it
   through the proxy, and the feed appears.
2. **A new host.** The feed redirects to a media host that isn't approved. The app's lookup gets "no
   such name" and the fetch fails; the app's page shows an access request for the media host. The
   owner approves it, the app keeps running, and the next try works.
3. **Exfiltration refused.** A compromised app looks up `<data>.attacker.example`. It gets `NXDOMAIN`,
   and no DNS server outside the machine ever sees the name.
4. **Service names.** The app's API reaches its database as `db`, as before.
5. **Upgrade.** After an upgrade every app restarts once and keeps its data; its approved hosts
   resolve.

## Requirements

- **FR-001**: Every app runs `ys-dns` (section 1) from the CoreDNS image, pinned by digest like the
  egress image; an app installed before the change gets the digest looked up and stored at its next
  apply.
- **FR-002**: `ys-dns` answers A and AAAA lookups of each approved host, matched exactly and in any
  letter case, with the machine resolver's answer unchanged, and other types of those names with an
  empty answer.
- **FR-003**: `ys-dns` answers every other name `NXDOMAIN` without forwarding it, and logs it.
- **FR-004**: Every app service resolves through `ys-dns` (section 4) and still resolves the app's
  service and container names; no app service gets a route out or a DNS server outside the app.
- **FR-005**: The `app` network's range is set as in section 5, with `ys-dns` at a fixed address
  outside the range Docker hands out.
- **FR-006**: Approving or removing a host changes what `ys-dns` answers in the same apply that
  changes Squid, without recreating the app's own containers.
- **FR-007**: Refused names that pass `HOST` become access requests merged with Squid's (decision 2).
- **FR-008**: Every place that names Your Space's own services includes `ys-dns` (section 7).
- **FR-009**: When `ys-dns` isn't running, an app's lookups of outside names fail; nothing falls
  back to another resolver.
- **FR-010**: The install guide's internet access paragraph says an app can look up the hosts
  approved for it and no others, and a decision record supersedes the 2026-11-14 one where it says
  apps resolve only container names.
- **FR-011**: Tests cover the Corefile for no hosts, several hosts and mixed case; the adapted
  Compose file (`dns`, `dns_search`, `ipam`, `ys-dns`'s address, labels and limits); refused-lookup
  access requests; and an end-to-end check on CI's engine that an app service resolves an approved
  host and a service name, gets `NXDOMAIN` for an unapproved one, and still can't connect directly
  out. The same end-to-end check runs once on a Mac engine before the change is released.

## Sources

- This repository: `runtime/src/adapter.ts` (`adapt()`, `egressConfig()`), `runtime/src/apps.ts`
  (image lookup, `up`, denied hosts), `server/src/apps/service.ts` (`HOST`, `approve()`,
  `removeOutbound()`), `docs/architecture/decisions.md` (2026-11-14 app network decisions).
- Docker Engine 26.1 release notes, on forwarding to a DNS server inside an internal network:
  https://docs.docker.com/engine/release-notes/26.1/ and https://github.com/moby/moby/pull/47832
- The CVE-2024-29018 fix that stopped forwarding out of internal networks:
  https://docs.docker.com/engine/release-notes/26.0/
- CoreDNS plugins used: `view` (https://coredns.io/plugins/view/), `forward`
  (https://coredns.io/plugins/forward/), `template` (https://coredns.io/plugins/template/), `log`
  (https://coredns.io/plugins/log/).
