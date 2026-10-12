# Table Host image for the Linux table PC. Runs with host networking so decks on the LAN can reach it.
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY packages ./packages
COPY apps/table-host ./apps/table-host
COPY games ./games
ENV PORT=8080 DATA_DIR=/data GAMES_DIR=/app/games
VOLUME ["/data"]
EXPOSE 8080
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/table-host/src/main.ts"]
