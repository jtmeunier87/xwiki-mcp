FROM node:20-alpine AS builder
WORKDIR /app
COPY . .
RUN npm ci && npm run build

FROM node:20-alpine AS runner
WORKDIR /app

# Copy built output and production deps only
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
RUN npm ci --omit=dev

# Install supergateway globally for streamable HTTP transport
RUN npm install -g supergateway

# Non-root user
RUN addgroup -S mcp && adduser -S mcp -G mcp
USER mcp

# stdio entrypoint — override with supergateway in compose for HTTP transport
ENTRYPOINT ["node", "dist/index.js"]
