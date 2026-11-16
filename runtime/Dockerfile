# Build context: the repository root.
# The Docker CLI and its Compose plugin come from Docker's own image (Apache-2.0).
FROM docker:29-cli AS docker

FROM node:26-slim
ENV NODE_ENV=production
COPY --from=docker /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker /usr/local/libexec/docker/cli-plugins/docker-compose /usr/local/libexec/docker/cli-plugins/docker-compose
WORKDIR /app/runtime
# No npm dependencies: Node.js and the Docker CLI only.
COPY runtime/src src
COPY runtime/bin bin
ENV PATH=/app/runtime/bin:$PATH
# Root, to use the engine's socket whatever group owns it. It has no network (deploy/stack.yaml).
CMD ["node", "src/index.ts"]
