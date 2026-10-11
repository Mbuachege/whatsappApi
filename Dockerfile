# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json package-lock.json* ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci --only=production && \
    npm install typescript ts-node

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
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/v1/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

# Start server
CMD ["node", "dist/server.js"]
