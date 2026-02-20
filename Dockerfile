# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app

RUN apk add --no-cache bash tini \
	&& addgroup -S agent \
	&& adduser -S -G agent -h /home/agent agent \
	&& mkdir -p /home/agent/.agent \
	&& chown -R agent:agent /home/agent /app

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public
COPY deploy/docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && chown agent:agent /entrypoint.sh

USER agent
ENV HOME=/home/agent
ENV AGENT_CONFIG_PATH=/home/agent/.agent/config.yaml
EXPOSE 8080

ENTRYPOINT ["/sbin/tini", "--", "/entrypoint.sh"]
CMD ["node", "dist/index.js"]
