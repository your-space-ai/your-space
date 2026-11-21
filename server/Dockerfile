# Build context: the repository root.
FROM node:26-slim
ENV NODE_ENV=production
WORKDIR /app

# Install the server's production dependencies only. The other workspace manifests are copied so
# npm can read the workspace layout in the lockfile.
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
COPY e2e/package.json e2e/
COPY runtime/package.json runtime/
COPY cli/package.json cli/
RUN npm ci --omit=dev --workspace server --no-audit --no-fund && npm cache clean --force

COPY appearance/theme.mjs appearance/theme.mjs
COPY workspace-layout/model.mjs workspace-layout/model.mjs
COPY server/src server/src
COPY server/drizzle server/drizzle
COPY server/bin server/bin

# create-owner and reset-link are on PATH for `docker compose exec server <command>`.
ENV PATH=/app/server/bin:$PATH
WORKDIR /app/server
USER node
EXPOSE 3000
CMD ["node", "src/index.ts"]
