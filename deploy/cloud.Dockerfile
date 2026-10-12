# Cloud service image for the Kubernetes cluster (games.skylar.technology).
FROM node:26-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY packages ./packages
COPY apps/cloud ./apps/cloud
# Calendar version (YYYY.MM.DD.N), stamped by the deploy workflow; any other build reports "dev".
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
ENV PORT=8081
EXPOSE 8081
# Numeric, so the image is verifiably non-root on its own (uid 1000 is the image's 'node' user).
USER 1000:1000
CMD ["node", "apps/cloud/src/main.ts"]
