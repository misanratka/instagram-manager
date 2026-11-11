# Render worker: does ONLY the ffmpeg rendering for InstaManager. Build context = repo root.
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg ca-certificates fonts-dejavu-core fonts-liberation fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY render-worker/package.json ./
RUN npm install --omit=dev
COPY render-worker/server.js ./
# Same render code as the main backend, so both produce identical videos
COPY backend/services/videoProcessor.js backend/services/brandCard.js backend/services/logger.js ./services/

ENV UPLOAD_DIR=/tmp/work
EXPOSE 3002
CMD ["node", "--max-old-space-size=380", "server.js"]
