FROM node:20-alpine
WORKDIR /app
COPY server.js .
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser
EXPOSE 3100
CMD ["node", "server.js"]
