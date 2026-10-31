FROM node:22-slim AS build
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .
RUN npx prisma generate
# NEXTAUTH_SECRET is read at runtime; this placeholder only satisfies the build.
RUN NEXTAUTH_SECRET=build-time-placeholder-not-used npm run build
RUN npm prune --omit=dev

FROM node:22-slim
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --chown=node:node --from=build /app/package.json /app/next.config.mjs ./
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/.next ./.next
COPY --chown=node:node --from=build /app/public ./public
COPY --chown=node:node --from=build /app/prisma ./prisma
COPY --chown=node:node --from=build /app/scripts ./scripts
USER node
EXPOSE 3000
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]
