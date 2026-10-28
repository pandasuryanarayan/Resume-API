# Build:
#   docker build -t resume-api .
#   docker run -p 3000:3000 resume-api

FROM node:20-alpine

WORKDIR /app

# Dependencies first so the layer caches across source edits.
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY src ./src
COPY public ./public
COPY assets ./assets

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "src/index.js"]
