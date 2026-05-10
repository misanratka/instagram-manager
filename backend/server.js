require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const { initDB } = require('./models/db');
const accountRoutes = require('./routes/accounts');
const contentRoutes = require('./routes/content');
const postRoutes = require('./routes/posts');
const { errorHandler } = require('./middleware/errorHandler');
const { startScheduler } = require('./services/scheduler');
const logger = require('./services/logger');

const app = express();
const PORT = process.env.PORT || 3001;

// Write Instagram cookies from env var if provided (used in cloud deployments)
if (process.env.INSTAGRAM_COOKIES) {
  const cookiesPath = path.resolve('./cookies.txt');
  fs.writeFileSync(cookiesPath, process.env.INSTAGRAM_COOKIES);
  logger.info('Wrote INSTAGRAM_COOKIES to cookies.txt');
}

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

app.get('/api/health', (req, res) =>
  res.json({ status: 'ok', time: new Date().toISOString() })
);

app.use(errorHandler);

async function start() {
  await initDB();
  startScheduler();
  app.listen(PORT, () => {
    logger.info(`Backend running at http://localhost:${PORT}`);
    if (!process.env.GEMINI_API_KEY) logger.warn('GEMINI_API_KEY not set — transcription and AI captions will be skipped');
    if (!process.env.PUBLIC_URL)     logger.warn('PUBLIC_URL not set — Instagram posting requires a public URL');
  });
}

start().catch(err => { logger.error('Startup failed:', err); process.exit(1); });
