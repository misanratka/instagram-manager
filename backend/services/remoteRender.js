// Sends video renders to extra render workers (free servers) so several videos can render at the same time.
// Main backend env:  RENDER_WORKERS=https://worker-one.onrender.com,https://worker-two.hf.space   RENDER_SECRET=<same as workers>
// If nothing is configured, or a worker fails, everything simply renders locally as before.
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const logger = require('./logger');

const secret = () => process.env.RENDER_SECRET || '';
const publicUrl = () => (process.env.PUBLIC_URL || '').replace(/\/$/, '');
const uploadDir = () => path.resolve(process.env.UPLOAD_DIR || './uploads');
const TIMEOUT_MS = Number(process.env.RENDER_WORKER_TIMEOUT_MS) || 25 * 60 * 1000;

let workers = null;
function list() {
  if (workers) return workers;
  workers = (process.env.RENDER_WORKERS || '').split(',').map(s => s.trim().replace(/\/$/, '')).filter(Boolean)
    .map(url => ({ url, busy: false, downUntil: 0 }));
  return workers;
}

const enabled = () => !!(secret() && publicUrl() && list().length);

/** Takes a free worker (or null). Call release() when the job is over. */
function reserve() {
  if (!enabled()) return null;
  const w = list().find(x => !x.busy && Date.now() >= x.downUntil);
  if (w) w.busy = true;
  return w || null;
}
const release = (w) => { if (w) w.busy = false; };

const headers = () => ({ 'x-render-secret': secret() });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Free servers go to sleep when idle: the first request wakes them (can take up to a minute or two).
async function wake(w) {
  let last;
  for (let i = 0; i < 8; i++) {
    try { const r = await axios.get(`${w.url}/health`, { timeout: 25000 }); if (r.data?.ok) return; } catch (e) { last = e; }
    await sleep(8000);
  }
  throw new Error('worker did not wake up: ' + (last?.message || 'no answer'));
}

/**
 * @param {{url:string}} w   worker from reserve()
 * @param {{kind:'framed'|'layout', inputPath:string, card?:{cardPath:string,width:number,height:number}, payload:object}} job
 * @returns {{path:string, filename:string, url:string}}
 */
async function renderOn(w, job) {
  try {
    await wake(w);
    const body = {
      ...job.payload,
      kind: job.kind,
      inputUrl: `${publicUrl()}/uploads/${encodeURIComponent(path.basename(job.inputPath))}`
    };
    if (job.card?.cardPath && fs.existsSync(job.card.cardPath)) {
      body.cardB64 = fs.readFileSync(job.card.cardPath).toString('base64');
      body.card = { width: job.card.width, height: job.card.height };
    }
    const t0 = Date.now();
    const start = await axios.post(`${w.url}/render`, body, { headers: headers(), timeout: 60000, maxBodyLength: Infinity });
    const id = start.data.jobId;
    for (;;) {
      if (Date.now() - t0 > TIMEOUT_MS) throw new Error('worker timed out');
      await sleep(3000);
      const s = await axios.get(`${w.url}/status/${id}`, { headers: headers(), timeout: 30000 });
      if (s.data.status === 'error') throw new Error('worker: ' + (s.data.error || 'render failed'));
      if (s.data.status === 'done') break;
    }
    const filename = `enhanced_${uuidv4()}.mp4`;
    const outPath = path.join(uploadDir(), filename);
    const r = await axios.get(`${w.url}/out/${id}`, { headers: headers(), responseType: 'stream', timeout: 5 * 60 * 1000, maxContentLength: Infinity });
    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(outPath);
      r.data.pipe(ws); ws.on('finish', resolve); ws.on('error', reject); r.data.on('error', reject);
    });
    axios.delete(`${w.url}/out/${id}`, { headers: headers(), timeout: 15000 }).catch(() => {});
    logger.info(`[remote] rendered on ${w.url} in ${Math.round((Date.now() - t0) / 1000)}s`);
    return { path: outPath, filename, url: `${publicUrl()}/uploads/${filename}` };
  } catch (e) {
    w.downUntil = Date.now() + 2 * 60 * 1000;   // rest a failing worker for 2 minutes; renders fall back to local
    throw e;
  }
}

module.exports = { enabled, reserve, release, renderOn };
