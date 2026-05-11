require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const { initDB } = require('./models/db');
const accountRoutes = require('./routes/accounts');
const contentRoutes = require('./routes/content');
const postRoutes = require('./routes/posts');
const authRoutes = require('./routes/auth');
const { errorHandler } = require('./middleware/errorHandler');
const { startScheduler } = require('./services/scheduler');
const logger = require('./services/logger');

const app = express();
const PORT = process.env.PORT || 3001;

// INSTAGRAM_COOKIES is the old env var name — no longer used (replaced by INSTAGRAM_COOKIES_CONTENT in downloader.js)

// Ensure uploads dir exists
const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(uploadDir));

app.use('/api/accounts', accountRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/posts', postRoutes);
app.use('/auth', authRoutes);

app.get('/api/health', (req, res) =>
  res.json({ status: 'ok', time: new Date().toISOString() })
);

// Serve React frontend (built into /public by Dockerfile)
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));
app.get('*', (req, res) => {
  const index = path.join(publicDir, 'index.html');
  if (fs.existsSync(index)) {
    res.sendFile(index);
  } else {
    res.status(503).send('Frontend not built. On Render: go to Settings → change Dockerfile Path to <code>./Dockerfile</code> and Root Directory to <code>.</code> (repo root), then redeploy.');
  }
});

app.use(errorHandler);

async function start() {
  await initDB();
  startScheduler();
  app.listen(PORT, () => {
    logger.info(`Backend running at http://localhost:${PORT}`);
    if (!process.env.GROQ_API_KEY) logger.warn('GROQ_API_KEY not set — transcription and AI captions will be skipped');
    if (!process.env.PUBLIC_URL)     logger.warn('PUBLIC_URL not set — Instagram posting requires a public URL');
  });
}

start().catch(err => { logger.error('Startup failed:', err); process.exit(1); });
