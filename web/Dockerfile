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
COPY web web
RUN npm run build --workspace web

# Caddy serves the built web client and forwards /api to the server (research R2, R9).
FROM caddy:2.11
COPY --from=build /app/web/dist /srv
COPY deploy/Caddyfile /etc/caddy/Caddyfile
# The Caddyfile of a published app's own Caddy, which runs this image too.
COPY deploy/published.caddyfile /etc/caddy/published.caddyfile
