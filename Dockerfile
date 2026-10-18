# One container that serves both the API and the website.
# Build:  docker build -t app-builder --build-arg VITE_TURNSTILE_SITE_KEY=your_site_key .
# Run:    docker run -p 3000:3000 -e ANTHROPIC_API_KEY=... -e TURNSTILE_SECRET=... app-builder

FROM node:22-slim AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm install --no-audit --no-fund
COPY client/ ./
ARG VITE_TURNSTILE_SITE_KEY=""
ARG VITE_APP_NAME="App Builder"
ENV VITE_TURNSTILE_SITE_KEY=$VITE_TURNSTILE_SITE_KEY VITE_APP_NAME=$VITE_APP_NAME
RUN npm run build

FROM node:22-slim
WORKDIR /app/server
COPY server/package*.json ./
RUN npm install --no-audit --no-fund
COPY server/ ./
COPY --from=client /app/client/dist /app/client/dist
ENV NODE_ENV=production PORT=3000 TRUST_PROXY=true CLIENT_DIST=/app/client/dist
EXPOSE 3000
USER node
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://localhost:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["./node_modules/.bin/tsx", "start.ts"]
