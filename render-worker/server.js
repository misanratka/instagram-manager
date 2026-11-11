// InstaManager render worker. Renders one video at a time for the main backend, then hands the file back.
// Env: RENDER_SECRET (required, same value as on the main backend), PORT, FFMPEG_THREADS.
const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || '/tmp/work';
fs.mkdirSync(process.env.UPLOAD_DIR, { recursive: true });
const WORK = path.resolve(process.env.UPLOAD_DIR);

const logger = require('./services/logger');
const { enhanceVideo, renderFramed } = require('./services/videoProcessor');

const SECRET = process.env.RENDER_SECRET || '';
if (!SECRET) logger.warn('RENDER_SECRET is not set: the worker will refuse all render requests');

const app = express();
app.use(express.json({ limit: '12mb' }));

app.get('/health', (req, res) => res.json({ ok: true, busy: !!current }));

app.use((req, res, next) => {
  if (!SECRET || req.headers['x-render-secret'] !== SECRET) return res.status(401).json({ error: 'Unauthorized' });
  next();
});

const jobs = new Map();   // id -> { status: running|done|error, error, outPath, finishedAt, startedAt }
let current = null;

const rm = (p) => { try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch { /* ignore */ } };

async function download(url, dest) {
  const r = await axios.get(url, { responseType: 'stream', timeout: 120000, maxContentLength: Infinity });
  await new Promise((resolve, reject) => {
    const w = fs.createWriteStream(dest);
    r.data.pipe(w); w.on('finish', resolve); w.on('error', reject); r.data.on('error', reject);
  });
}

async function run(job, b) {
  const files = [];
  try {
    const ext = path.extname(new URL(b.inputUrl).pathname) || '.mp4';
    const inputPath = path.join(WORK, `in_${job.id}${ext}`); files.push(inputPath);
    await download(b.inputUrl, inputPath);
    logger.info(`[worker] input downloaded (${Math.round(fs.statSync(inputPath).size / 1024)} KB)`);

    let cardPath = null;
    if (b.cardB64) { cardPath = path.join(WORK, `card_${job.id}.png`); files.push(cardPath); fs.writeFileSync(cardPath, Buffer.from(b.cardB64, 'base64')); }

    let result;
    if (b.kind === 'framed') {
      result = await renderFramed({
        inputPath, frame: b.frame, trim: b.trim, quality: b.quality || 'best',
        card: cardPath ? { cardPath, width: b.card.width, height: b.card.height } : null
      });
    } else {
      const p = b.params || {};
      result = await enhanceVideo({
        inputPath, srtContent: p.srtContent || '', segments: p.segments || [], textOverlays: p.textOverlays || [],
        burnSubtitles: !!p.burnSubtitles, subtitleStyle: p.subtitleStyle || 'standard', enhance: !!p.enhance,
        trim: p.trim, adjustments: p.adjustments, speed: p.speed, cropRatio: p.cropRatio,
        brand: b.brand ? { ...b.brand, cardPath } : null
      });
    }
    job.outPath = result.path; job.status = 'done';
  } catch (e) {
    logger.error('[worker] render failed: ' + e.message);
    job.status = 'error'; job.error = e.message;
  } finally {
    job.finishedAt = Date.now();
    files.forEach(rm);
    current = null;
  }
}

app.post('/render', (req, res) => {
  if (current) return res.status(429).json({ error: 'busy' });
  const b = req.body || {};
  if (!b.inputUrl || !['framed', 'layout'].includes(b.kind)) return res.status(400).json({ error: 'Bad request' });
  // Optional safety: only fetch videos from your own backend (set MAIN_URL to its address)
  const main = (process.env.MAIN_URL || '').replace(/\/$/, '');
  if (main && !String(b.inputUrl).startsWith(main + '/')) return res.status(400).json({ error: 'Input URL not allowed' });
  const id = uuidv4();
  const job = { id, status: 'running', startedAt: Date.now() };
  jobs.set(id, job); current = id;
  run(job, b);
  res.status(202).json({ jobId: id });
});

app.get('/status/:id', (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j) return res.status(404).json({ error: 'unknown job' });
  res.json({ status: j.status, error: j.error || null, elapsed_s: Math.round(((j.finishedAt || Date.now()) - j.startedAt) / 1000) });
});

app.get('/out/:id', (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j || j.status !== 'done' || !fs.existsSync(j.outPath)) return res.status(404).json({ error: 'not ready' });
  res.download(j.outPath, 'out.mp4');
});

app.delete('/out/:id', (req, res) => {
  const j = jobs.get(req.params.id);
  if (j) { rm(j.outPath); jobs.delete(j.id); }
  res.json({ ok: true });
});

// Never keep finished files for long (small disk)
setInterval(() => {
  const cutoff = Date.now() - 20 * 60 * 1000;
  for (const [id, j] of jobs) if (j.finishedAt && j.finishedAt < cutoff) { rm(j.outPath); jobs.delete(id); }
}, 5 * 60 * 1000).unref();

const PORT = process.env.PORT || 3002;
app.listen(PORT, () => logger.info(`Render worker listening on ${PORT}`));
