FROM node:20 AS builder

WORKDIR /app

COPY package*.json ./
COPY tsconfig.json ./
COPY src ./src
COPY whatsapp-dashboard.html ./

RUN npm install
RUN npm run build

FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

RUN apk add --no-cache curl

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/whatsapp-dashboard.html ./
COPY package.json ./

VOLUME ["/app/.waweb"]

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD curl -f http://localhost:3000/api/v1/health || exit 1

CMD ["node", "dist/server.js"]
