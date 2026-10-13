# Table Host image for the Linux table PC. Runs with host networking so decks on the LAN can reach it.
FROM node:26-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY packages ./packages
COPY apps/table-host ./apps/table-host
COPY games ./games
# Calendar version (YYYY.MM.DD.N), stamped by the deploy workflow; any other build reports "dev".
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
ENV PORT=8080 DATA_DIR=/data GAMES_DIR=/app/games
# Create /data owned by uid 1000 before declaring the volume, so new volumes inherit that owner.
# (The table PC kit mounts /var/lib/gametable here and chowns it to uid 1000 itself.)
RUN mkdir -p /data && chown 1000:1000 /data
VOLUME ["/data"]
EXPOSE 8080
# Numeric, so the image is verifiably non-root on its own (uid 1000 is the image's 'node' user).
USER 1000:1000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/table-host/src/main.ts"]
