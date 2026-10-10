FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY src ./src
COPY config ./config
COPY dashboard ./dashboard
COPY lavalink ./lavalink
COPY README.md .env.example ./
RUN mkdir -p /app/data
ENV NODE_ENV=production
CMD ["node","src/index.js"]
