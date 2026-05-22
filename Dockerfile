FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg python3 curl ca-certificates fonts-dejavu-core \
    && curl -fL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
       -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && rm -rf /var/lib/apt/lists/*

# Build frontend
WORKDIR /frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
# cache-bust: 2026-05-22-v2
RUN npm run build

# Set up backend
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY backend/ ./

# Copy built frontend into backend's public directory
RUN cp -r /frontend/dist /app/public

EXPOSE 3001
CMD ["node", "server.js"]
