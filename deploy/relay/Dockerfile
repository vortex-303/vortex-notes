# Build context = repo root; dist/ must be built first (npm run build).
FROM node:22-slim
WORKDIR /app
COPY deploy/relay/package.json ./package.json
RUN npm install --omit=dev && npm cache clean --force
COPY dist ./dist
ENV NODE_ENV=production
EXPOSE 7300
CMD ["node", "dist/relay/main.js"]
