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
# cache-bust: 2026-05-22-v4
COPY frontend/ ./
RUN npm run build
 
# Set up backend
WORKDIR /app
COPY backend/package*.json ./
RUN npm install --omit=dev
COPY backend/ ./
 
# Replace backend/public entirely with the fresh frontend build
RUN rm -rf /app/public && cp -r /frontend/dist /app/public
 
EXPOSE 3001
CMD ["node", "server.js"]
