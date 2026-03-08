FROM mcr.microsoft.com/playwright:v1.58.2-noble
WORKDIR /app
COPY package.json server.js ./
RUN npm install --production
USER pwuser
EXPOSE 3200
CMD ["node", "server.js"]
