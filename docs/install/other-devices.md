---
title: "Use Your Space from other devices"
---

By default Your Space answers only on this machine, at `http://space.localhost`. To use it from a phone or
another computer, give it an HTTPS address in one of three ways:

| Way | You need | Who can reach it |
| --- | --- | --- |
| [Your own domain](#use-your-own-domain) | A domain whose DNS points at this server, with ports 80 and 443 open to the internet | Anyone on the internet; only the owner can sign in |
| [Your own reverse proxy](#use-your-own-reverse-proxy) | A proxy that already handles HTTPS, on this machine or in a container | Whoever can reach your proxy |
| [Tailscale](#use-tailscale) | Tailscale on this server and on each device | Only your devices on your tailnet |

A plain `http://` address on your network is not one of them; see
[Plain HTTP on Your Network Is Not Supported](#plain-http-on-your-network-is-not-supported).

`your-space configure` changes the setup: it asks the same question as `init`, writes `.env`,
checks what it can, and restarts Your Space with the new address. If the new setup can't start, it
puts the old one back. By hand, change `.env` and run `docker compose up -d`. Then open the address
on the other device and sign in with the same username and password. It's the same account and
workspace, so there is nothing to set up again.

## Use Your Own Domain

1. Point the domain's DNS `A` record at this server. IPv6 isn't supported yet, so don't add an
   `AAAA` record.
2. Open ports 80 and 443 to the internet, in the firewall and any router port forwarding. Let's
   Encrypt reaches the server through them to issue the certificate.
3. For apps, point a wildcard record (`*.space.example.com`) at the same server too. Each app is
   at `<app>.space.example.com`, and Caddy gets its certificate when it is first opened.
4. Give Your Space the domain, as just the name, without `https://`:

   ```sh
   your-space configure --domain space.example.com
   ```

   Or choose it when you run `init`. `your-space` first checks that `space.example.com` and a name
   under it both resolve, to the same addresses, and stops if they don't; add `--ignore-checks` to
   go on anyway. It can't tell from inside whether those addresses are this server's public one, so
   it shows them. By hand, add `YS_DOMAIN=space.example.com` to `.env` and run `docker compose up -d`.

Caddy gets a certificate, renews it automatically, and redirects `http://space.example.com` to
HTTPS. If the address doesn't load, see [Certificates](#certificates). The server refuses names
that can't get a public certificate, such as an IP address, `localhost`, or a Tailscale `.ts.net`
name, and says what to use instead.

## Use Your Own Reverse Proxy

Use this if a proxy, such as nginx, Caddy, Traefik, or Nginx Proxy Manager, already handles HTTPS
for other services.

1. Give Your Space the address your proxy serves:

   ```sh
   your-space configure --proxy-url https://space.example.com
   ```

   Your Space then serves plain HTTP on `127.0.0.1:8080`, reachable only from this machine, and
   doesn't use ports 80 and 443 at all, so it doesn't compete with your proxy for them. It gets no
   certificate. If another program has port 8080, add `--port 8090` (or any free port) and use that
   port below for a proxy on this machine. A proxy in a container on Your Space's network still
   reaches it at `http://your-space:8080`, because the port only changes on this machine's side. By hand, add `YS_PROXY_URL=https://space.example.com` (and `YS_PORT`) to `.env`.

2. If you set it by hand, run `docker compose up -d`. `your-space status` now lists, under "Your
   proxy or tunnel forwards", the names your proxy must send to Your Space, each app's included.

3. Point your proxy at Your Space:

   - **A proxy on this machine** forwards to `http://127.0.0.1:8080`.
   - **A proxy in a container** can't reach `127.0.0.1` on the machine. Instead, join it to Your
     Space's network, `your-space_edge`, and forward to `http://your-space:8080`. In your proxy's
     Compose file:

     ```yaml
     services:
       proxy:              # your proxy's service
         networks: [default, your-space]
     networks:
       your-space:
         external: true
         name: your-space_edge
     ```

     The network exists once Your Space runs with `YS_PROXY_URL`, so start Your Space first.
     Attach only your proxy to it: Your Space accepts a visitor's address from anything on it.

4. Your proxy must:

   - **pass the original `Host` header.** Your Space answers only to the address in `YS_PROXY_URL`.
     Requests that arrive under another name get status 421 and a message that says to fix this;
   - **set `X-Forwarded-For` to the visitor's address,** replacing any value the visitor sent. The
     sign-in limit counts attempts per address;
   - **forward apps' names too.** Each app is at `<app>.<your proxy's name>`, such as
     `sure.space.example.com`, so give the proxy a wildcard name (`*.space.example.com`) with its
     certificate and forward it to the same place. Every name other than Your Space's own goes to
     an app.

   Caddy and Traefik do both by default. In nginx, add:

   ```nginx
   proxy_set_header Host $http_host;
   proxy_set_header X-Forwarded-For $remote_addr;
   ```

Your Space reads the visitor's address only from connections to port 8080. Visitors on your own
network, with addresses such as `192.168.1.20`, look like proxies, so behind a proxy they share one
sign-in limit. Don't let your proxy add to an `X-Forwarded-For` the visitor sent (in nginx,
`$proxy_add_x_forwarded_for`): a device on your own network could then put a made-up address in
front of its own and get a fresh sign-in limit for every guess.

## Use Tailscale

[Tailscale](https://tailscale.com) gives this server an HTTPS address that only your own devices can
reach. You need no domain and no ports open to the internet.

1. Install Tailscale on this server and on each device you'll use, signed in to the same tailnet
   (your Tailscale network).
3. On the server, run (on Linux, with `sudo`):

   ```sh
   tailscale serve --bg --https=443 http://127.0.0.1:8080
   ```

   If you set `YS_PORT`, use that port instead of `8080`.

   It prints the server's address, such as `https://myserver.tail1234.ts.net`. If it says HTTPS
   isn't enabled for your tailnet, follow the link it prints. `--bg` keeps it serving after you
   close the terminal; `tailscale serve status` shows the address again. Until the next two steps
   are done, the address shows an error page.

3. Give Your Space that address, with `https://` and no trailing slash:

   ```sh
   your-space configure --proxy-url https://myserver.tail1234.ts.net
   ```

   By hand, add `YS_PROXY_URL=https://myserver.tail1234.ts.net` to `.env` and run
   `docker compose up -d`.

Tailscale passes the original `Host` header and the visitor's tailnet address, so nothing else needs
setting up for Your Space itself. Apps can't have their built-in names over Tailscale, such as
`sure.myserver.tail1234.ts.net`, because Tailscale's names can't hold a name under a machine's name.
Instead, [publish each app on a port](../apps/install-apps.md#publish-an-app-on-a-port) and give it a
[Tailscale Service](https://tailscale.com/kb/1552/tailscale-services) of its own: each app needs its
own address, and Tailscale gives one name per service. For Sure published on port 8081:

1. Make sure the server joined your tailnet as a tagged device, for example `tag:server`: a
   [Tailscale Service](https://tailscale.com/kb/1552/tailscale-services) can only be hosted by a device
   with a tag, not one signed in as a user. Tagging a device replaces its user identity, so first
   make sure your [access rules](https://tailscale.com/kb/1068/tags) still let you reach a
   `tag:server` device, for example over SSH; the rule for the service doesn't cover the server itself.
2. In Tailscale's admin console, under Services, define a service named `sure`.
3. On the server, run (on Linux, with `sudo`):

   ```sh
   tailscale serve --service=svc:sure --https=443 http://127.0.0.1:8081
   ```

4. In the admin console, approve this server as the service's host, and let your devices reach
   `svc:sure` in your access policy.
5. Give Your Space the service's address as the app's link, `https://sure.tail1234.ts.net`, in the
   app's Publishing settings.

## Plain HTTP on Your Network Is Not Supported

You can't use Your Space from another device at a plain address like `http://192.168.1.20`. Your
Space sends your password and session to other machines only over HTTPS, so nobody on the network
can read them or take over your session. `YS_PROXY_URL` must start with `https://`, and
`YS_DOMAIN` gets HTTPS from Let's Encrypt; the server refuses anything else, and
`docker compose logs server` says why.

For devices on your own network, use [Tailscale](#use-tailscale): it needs no domain.


## Certificates

With your own domain, Caddy asks Let's Encrypt for a certificate when it starts and renews it
automatically. `your-space start` and `your-space configure` wait up to three minutes for it, and
`your-space status` shows whether it is issued. If it isn't, they read Caddy's log and say why in
plain words. To see the log itself:

```sh
your-space logs caddy
```

The usual causes:

- **The domain doesn't point at this server.** Check the DNS `A` record.
- **Ports 80 or 443 are blocked.** Let's Encrypt must reach this server on both, from the internet.
  Check the firewall and any router port forwarding.
- **The domain has an `AAAA` (IPv6) record.** Let's Encrypt may try IPv6 first, and Your Space
  listens on IPv4 only for now. Remove the `AAAA` record.

Caddy keeps retrying, and it never falls back to serving your domain over plain HTTP. Certificates
are kept in the `ys-caddy-data` volume, so restarts don't request new ones.
