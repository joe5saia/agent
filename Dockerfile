# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app

COPY deploy/docker/apk-packages.txt /tmp/apk-packages.txt

RUN apk add --no-cache bash sudo tini \
	&& if [ -s /tmp/apk-packages.txt ]; then \
		awk '{ sub(/#.*/, "", $0); gsub(/^[ \t]+|[ \t]+$/, "", $0); if ($0 != "" && !seen[$0]++) print $0; }' /tmp/apk-packages.txt | xargs -r apk add --no-cache; \
	fi \
	&& addgroup -S agent \
	&& adduser -S -G agent -h /home/agent agent \
	&& install -d -m 0755 /etc/sudoers.d \
	&& printf "agent ALL=(ALL) NOPASSWD: ALL\nnode ALL=(ALL) NOPASSWD: ALL\n" > /etc/sudoers.d/agent \
	&& chmod 0440 /etc/sudoers.d/agent \
	&& mkdir -p /home/agent/.agent \
	&& chown -R agent:agent /home/agent /app \
	&& rm -f /tmp/apk-packages.txt

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
