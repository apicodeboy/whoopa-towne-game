# Whoopa Towne: one container that serves both the game (client) and the game server.
#
#   docker build -t whoopa-towne .
#   docker run -p 2567:2567 whoopa-towne        # then open http://localhost:2567
#
# The port can be changed with -e PORT=8080 (most hosts set PORT for you).

# ---- build: install everything, bundle the client and the server ----
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npm run build

# ---- run: only the server's runtime dependencies + the two build outputs ----
FROM node:24-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci --omit=dev --workspace=server && npm cache clean --force
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist
USER node
EXPOSE 2567
CMD ["node", "server/dist/index.js"]
