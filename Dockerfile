# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++ cairo-dev jpeg-dev pango-dev giflib-dev pixman-dev

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies with retry logic and timeout
RUN npm config set fetch-timeout 120000 && \
    npm config set fetch-retries 5 && \
    npm config set fetch-retries-base 1000 && \
    npm install --no-optional 2>&1 || npm install --no-optional 2>&1 || npm install --no-optional

# Copy source code
COPY src ./src
COPY whatsapp-dashboard.html ./

# Build TypeScript
RUN npm run build

# Production stage
FROM node:22-alpine

WORKDIR /app

# Set environment
ENV NODE_ENV=production
ENV PORT=3000

# Install curl for health check
RUN apk add --no-cache curl

# Copy from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/whatsapp-dashboard.html ./whatsapp-dashboard.html
COPY --from=builder /app/package.json ./package.json

# Volume for persistent SQLite database
VOLUME ["/app/.waweb"]

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=50s --retries=3 \
  CMD curl -f http://localhost:3000/api/v1/health || exit 1

# Start server
CMD ["node", "dist/server.js"]
