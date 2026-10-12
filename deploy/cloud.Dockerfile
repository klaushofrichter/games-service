# Cloud service image for the Kubernetes cluster (games.skylar.technology).
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY packages ./packages
COPY apps/cloud ./apps/cloud
ENV PORT=8081
EXPOSE 8081
USER node
CMD ["node", "apps/cloud/src/main.ts"]
