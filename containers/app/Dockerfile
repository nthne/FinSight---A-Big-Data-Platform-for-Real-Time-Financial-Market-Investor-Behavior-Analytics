FROM node:22.23.0-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

FROM dependencies AS build
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_MARKET_REFRESH_MODE=local
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY \
    VITE_MARKET_REFRESH_MODE=$VITE_MARKET_REFRESH_MODE
COPY . .
RUN npm run build

FROM node:22.23.0-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
WORKDIR /app
RUN groupadd --gid 1001 finsight \
    && useradd --uid 1001 --gid finsight --home-dir /app --create-home finsight
COPY --from=build --chown=finsight:finsight /app/.output ./.output
USER finsight
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]

