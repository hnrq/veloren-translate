
FROM node:20-slim AS builder
RUN npm install -g pnpm
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.base.json nx.json ./
COPY apps/html-to-markdown/package.json ./apps/html-to-markdown/
COPY apps/rss-digester/package.json ./apps/rss-digester/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm nx build @veloren-translate/html-to-markdown --configuration=production

FROM node:20-slim
ENV NODE_ENV=production
RUN npm install -g pnpm
WORKDIR /app
COPY --from=builder /app/apps/html-to-markdown/dist .
COPY --from=builder /app/apps/html-to-markdown/package.json .
RUN pnpm install --prod
ENV PORT 8080
CMD ["npx", "functions-framework", "--target=main", "--source=."]
