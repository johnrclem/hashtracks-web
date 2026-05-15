FROM mcr.microsoft.com/playwright:v1.58.2-noble
WORKDIR /app
# Copy both manifests so `npm ci` runs against the committed lockfile and
# produces a reproducible deploy. The stealth-plugin chain is fragile under
# transitive updates — pinning via the lockfile gives us a clean rollback
# path if a future patch release breaks Cloudflare bypass.
COPY package.json package-lock.json server.js ./
RUN npm ci --omit=dev
USER pwuser
EXPOSE 3200
CMD ["node", "server.js"]
