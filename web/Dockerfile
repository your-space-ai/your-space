# Build context: the repository root.
FROM node:26-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY server/package.json server/
COPY web/package.json web/
COPY e2e/package.json e2e/
COPY runtime/package.json runtime/
COPY cli/package.json cli/
RUN npm ci --workspace web --no-audit --no-fund
COPY shared/appearance/theme.mjs shared/appearance/theme.mjs
COPY shared/workspace-layout/model.mjs shared/workspace-layout/model.mjs
COPY web web
RUN npm run build --workspace web

# Caddy 2.11.9 is built with modules that have reachable vulnerabilities fixed in later versions
# (govulncheck: golang.org/x/net GO-2026-6860 and GO-2026-6866, github.com/klauspost/compress
# GO-2026-6865) and with a Go toolchain older than the net/http fix GO-2026-6859. Until a Caddy
# release includes them, rebuild the same version with those modules raised, cross-compiled so the
# arm64 image doesn't build under emulation. Drop this stage once caddy:2.11 ships the fixes.
FROM --platform=$BUILDPLATFORM caddy:2.11-builder AS caddy
ARG TARGETOS TARGETARCH
WORKDIR /src
# The same program xcaddy generates for a build with no plugins, so the modules are those of Caddy's
# own release, raised only where a fix needs it. `go get` never lowers a module another one needs.
RUN printf '%s\n' 'package main' \
      'import (' \
      '	caddycmd "github.com/caddyserver/caddy/v2/cmd"' \
      '	_ "github.com/caddyserver/caddy/v2/modules/standard"' \
      ')' \
      'func main() { caddycmd.Main() }' > main.go \
    && go mod init caddy \
    && go get github.com/caddyserver/caddy/v2@v2.11.9 \
      golang.org/x/net@v0.62.0 github.com/klauspost/compress@v1.20.2 \
    && go mod tidy \
    && CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH \
      go build -trimpath -tags nobadger,nomysql,nopgx -o /usr/bin/caddy .

# Caddy serves the built web client and forwards /api to the server (research R2, R9).
FROM caddy:2.11
COPY --from=caddy /usr/bin/caddy /usr/bin/caddy
# The same file capability the official image gives its build, which COPY doesn't keep.
RUN setcap cap_net_bind_service=+ep /usr/bin/caddy
COPY --from=build /app/web/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
# The Caddyfile of a published app's own Caddy, which runs this image too.
COPY deploy/published.caddyfile /etc/caddy/published.caddyfile
