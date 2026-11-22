# Build context: the repository root.
FROM node:26-slim
ENV NODE_ENV=production
WORKDIR /app

# Install the server's production dependencies only. The other workspace manifests are copied so
# npm can read the workspace layout in the lockfile. Better Auth optionally peers on Drizzle Kit,
# which is needed only to generate migrations in development.
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
COPY e2e/package.json e2e/
COPY runtime/package.json runtime/
COPY cli/package.json cli/
RUN npm ci --omit=dev --omit=optional --workspace server --no-audit --no-fund && npm cache clean --force

# Refresh the base's OS packages and remove build-time package managers from the running image.
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/* \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/yarn /usr/local/bin/yarnpkg \
    && rm -rf /usr/local/lib/node_modules/npm /opt/yarn-v*

COPY shared/appearance/theme.mjs shared/appearance/theme.mjs
COPY shared/workspace-layout/model.mjs shared/workspace-layout/model.mjs
COPY server/src server/src
COPY server/drizzle server/drizzle
COPY server/bin server/bin

# create-owner and reset-link are on PATH for `docker compose exec server <command>`.
ENV PATH=/app/server/bin:$PATH
WORKDIR /app/server
USER node
EXPOSE 3000
CMD ["node", "src/index.ts"]
