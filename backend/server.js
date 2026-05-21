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

const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',').map(o => o.trim());
app.use(cors({ origin: (origin, cb) => cb(null, !origin || allowedOrigins.some(o => origin.startsWith(o))), credentials: true }));
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

app.get('/health', (req, res) =>
  res.json({ status: 'ok' })
);

const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir));
app.get('*', (req, res) => {
  const index = path.join(publicDir, 'index.html');
  if (fs.existsSync(index)) {
    res.sendFile(index);
  } else {
    res.status(503).send('Frontend not built. On Render: go to Settings -> change Dockerfile Path to <code>./Dockerfile</code> and Root Directory to <code>.</code> (repo root), then redeploy.');
  }
});

app.use(errorHandler);

async function start() {
  await initDB();
  startScheduler();
  app.listen(PORT, () => {
    logger.info(`Backend running at http://localhost:${PORT}`);
    if (!process.env.GROQ_API_KEY) logger.warn('GROQ_API_KEY not set - transcription and AI captions will be skipped');
    if (!process.env.PUBLIC_URL) logger.warn('PUBLIC_URL not set - Instagram posting requires a public URL');
    if (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL) {
      logger.info(`Keep-alive enabled for ${(process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '')}`);
    } else {
      logger.warn('Keep-alive disabled - set PUBLIC_URL or RENDER_EXTERNAL_URL for Render self-ping');
    }
  });
}

start().catch(err => { logger.error('Startup failed:', err); process.exit(1); });
