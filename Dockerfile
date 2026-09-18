# Cloud Run image for the streamable-HTTP MCP server (issue #13). Not used
# for stdio installs — those run `npm install` locally per the README.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts: the "prepare" script runs "npm run build" itself, but
# tsconfig.json/src aren't copied in yet at this point.
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist

RUN useradd --system --create-home --shell /usr/sbin/nologin appuser
USER appuser

# Cloud Run injects PORT; create-streamable-http-server.ts / streamable-http-index.ts
# read it directly. HOST must be set to 0.0.0.0 via the Cloud Run service's
# env vars — it defaults to loopback-only (see streamable-http-index.ts).
EXPOSE 8080
CMD ["node", "dist/streamable-http-index.js"]
