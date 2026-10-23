# Build on the runner's own platform: the output is plain JavaScript and every
# production dependency is pure JS, so nothing runs Node under QEMU emulation
# (emulated Node crashed the arm64 build with SIGILL, exit code 132).
FROM --platform=$BUILDPLATFORM node:20-alpine AS builder
WORKDIR /app
COPY . .
RUN npm ci && npm run build && rm -rf node_modules && npm ci --omit=dev

# Install supergateway for streamable HTTP transport
RUN npm install -g supergateway

FROM node:20-alpine AS runner
WORKDIR /app

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
