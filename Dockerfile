# Build on the runner's own platform: the output is plain JavaScript and every
# production dependency is pure JS, so nothing runs Node under QEMU emulation
# (emulated Node crashed the arm64 build with SIGILL, exit code 132).
FROM --platform=$BUILDPLATFORM node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS builder
WORKDIR /app
COPY . .
RUN npm ci && npm run build && rm -rf node_modules && npm ci --omit=dev

# Install supergateway for streamable HTTP transport
RUN npm install -g supergateway@4.2.0

FROM node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS runner
WORKDIR /app

# Name in the MCP Registry (must match server.json)
LABEL io.modelcontextprotocol.server.name="io.github.jtmeunier87/xwiki-mcp"

# Copy built output and production deps only
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /usr/local/lib/node_modules/supergateway /usr/local/lib/node_modules/supergateway

# Link the supergateway command and add a non-root user (busybox only, no Node)
RUN ln -s ../lib/node_modules/supergateway/dist/index.js /usr/local/bin/supergateway \
  && addgroup -S mcp && adduser -S mcp -G mcp
USER mcp

# stdio entrypoint — override with supergateway in compose for HTTP transport
ENTRYPOINT ["node", "dist/index.js"]
