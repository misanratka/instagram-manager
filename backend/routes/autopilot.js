const express = require('express');
const crypto = require('crypto');
const { getDB } = require('../models/db');
const { createStore } = require('../services/autopilotStore');
const { getAutopilot, computeSlots, dueIndex, normalizeUrl, safeTz, SLOT_EXPIRY_MS } = require('../services/autopilot');

const router = express.Router();
const store = () => createStore(getDB());
const MAX_QUEUED = 200;

// ── public ping for an external scheduler (keeps the free server awake and triggers a check) ──
// GET or POST /api/autopilot/tick?key=<AUTOPILOT_KEY>  (or header x-api-key)
async function tickHandler(req, res, next) {
  try {
    const expected = process.env.AUTOPILOT_KEY || '';
    const given = String(req.headers['x-api-key'] || req.query.key || '');
    if (!expected) return res.status(403).json({ error: 'Set AUTOPILOT_KEY on the server first.' });
    const a = Buffer.from(given), b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(403).json({ error: 'Wrong key.' });
    const r = await getAutopilot().tick();
    res.json({ ok: true, started: r.started, reason: r.reason || null });   // the job keeps running in the background
  } catch (err) { next(err); }
}
router.get('/tick', tickHandler);
router.post('/tick', tickHandler);

// ── everything below needs the signed-in user, like the rest of the app ──
router.use((req, res, next) => {
  if (!req.headers['x-user-id']) return res.status(401).json({ error: 'Not signed in.' });
  next();
});

async function ownedPage(req, res) {
  const page = await store().getAccount(req.params.accountId);
  if (!page) { res.status(404).json({ error: 'Page not found.' }); return null; }
  if (page.user_id && page.user_id !== req.headers['x-user-id']) { res.status(403).json({ error: 'Not your page.' }); return null; }
  return page;
}

async function pageSummary(s, page) {
  const now = new Date();
  const { slots, dayStart, tz } = computeSlots(page, now);
  const done = await s.countToday(page.id, dayStart.toISOString());
  const counts = await s.queueCounts(page.id);
  const expired = slots.filter(t => now - t > SLOT_EXPIRY_MS).length;
  const idx = Math.max(done, expired);
  const next = idx < slots.length ? slots[idx] : null;
  return {
    id: page.id, name: page.name, username: page.username,
    enabled: !!page.ap_enabled,
    paused: page.ap_paused_reason || null,
    settings: {
      per_day: page.ap_per_day ?? 2, start_hour: page.ap_start_hour ?? 9, end_hour: page.ap_end_hour ?? 22,
      tz: page.ap_tz || null, layout: page.ap_layout === 'text' ? 'text' : 'card', credit_line: page.ap_credit_line === null || page.ap_credit_line === undefined ? true : !!page.ap_credit_line
    },
    today: { posted: done, target: slots.length, next_slot: next ? next.toISOString() : null, tz },
    queue: { queued: counts.queued || 0, processing: counts.processing || 0, posted: counts.posted || 0, failed: counts.failed || 0 },
    last_error: await s.lastError(page.id)
  };
}

// All pages with their autopilot state
router.get('/', async (req, res, next) => {
  try {
    const s = store();
    const pages = await s.listAccountsForUser(req.headers['x-user-id']);
    res.json({ busy: getAutopilot().isBusy(), pages: await Promise.all(pages.map(p => pageSummary(s, p))) });
  } catch (err) { next(err); }
});

// One short line per page — cheap for a bot to read. GET /api/autopilot/summary
router.get('/summary', async (req, res, next) => {
  try {
    const s = store();
    const pages = await s.listAccountsForUser(req.headers['x-user-id']);
    const lines = [];
    for (const p of pages) {
      const x = await pageSummary(s, p);
      lines.push(`${x.username || x.name}: ${x.paused ? 'PAUSED' : x.enabled ? 'ON' : 'off'} | today ${x.today.posted}/${x.today.target} | queue ${x.queue.queued} | failed ${x.queue.failed}${x.last_error ? ` | last error: ${String(x.last_error).slice(0, 80)}` : ''}`);
    }
    res.type('text/plain').send(lines.join('\n') || 'No pages.');
  } catch (err) { next(err); }
});

// Settings. Body (all optional): enabled, per_day, start_hour, end_hour, tz, layout, credit_line
router.put('/:accountId/settings', async (req, res, next) => {
  try {
    const page = await ownedPage(req, res); if (!page) return;
    const b = req.body || {};
    const s = {};
    if (b.enabled !== undefined) s.enabled = b.enabled === true || b.enabled === 'true' || b.enabled === 1;
    if (b.per_day !== undefined) {
      const n = Number(b.per_day);
      if (!Number.isInteger(n) || n < 1 || n > 8) return res.status(400).json({ error: 'Posts per day must be 1 to 8.' });
      s.per_day = n;
    }
    const start = b.start_hour !== undefined ? Number(b.start_hour) : (page.ap_start_hour ?? 9);
    const end = b.end_hour !== undefined ? Number(b.end_hour) : (page.ap_end_hour ?? 22);
    if (b.start_hour !== undefined || b.end_hour !== undefined) {
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > 23 || end < 1 || end > 24 || end <= start)
        return res.status(400).json({ error: 'Posting window must start before it ends (hours 0 to 24).' });
      s.start_hour = start; s.end_hour = end;
    }
    if (b.tz !== undefined) {
      if (safeTz(b.tz) !== b.tz) return res.status(400).json({ error: 'Unknown time zone.' });
      s.tz = b.tz;
    }
    if (b.layout !== undefined) {
      if (!['card', 'text'].includes(b.layout)) return res.status(400).json({ error: 'Layout must be card or text.' });
      s.layout = b.layout;
    }
    if (b.credit_line !== undefined) s.credit_line = b.credit_line === true || b.credit_line === 'true' || b.credit_line === 1;
    if (s.enabled === true && !(b.tz || page.ap_tz)) s.tz = 'UTC';
    await store().updateSettings(page.id, s);
    if (s.enabled === true) await store().resetFail(page.id);   // switching on clears an old pause
    res.json(await pageSummary(store(), await store().getAccount(page.id)));
  } catch (err) { next(err); }
});

// Add links to a page's queue. Body: { urls: ["..."] | url: "...", options?: { layout, instructions, must_include, mentions, hashtags, ai_hashtags, tos_exact, tos_must_include, credit_line } }
router.post('/:accountId/queue', async (req, res, next) => {
  try {
    const page = await ownedPage(req, res); if (!page) return;
    const b = req.body || {};
    const raw = Array.isArray(b.urls) ? b.urls : String(b.urls || b.url || '').split(/\s+/);
    const urls = raw.map(x => String(x).trim()).filter(Boolean);
    if (!urls.length) return res.status(400).json({ error: 'Send at least one link.' });
    const s = store();
    const counts = await s.queueCounts(page.id);
    let room = MAX_QUEUED - (counts.queued || 0);
    const out = { added: 0, duplicates: [], invalid: [], overflow: [] };
    const options = b.options && typeof b.options === 'object' ? b.options : null;
    for (const u of urls) {
      const url = normalizeUrl(u);
      if (!url) { out.invalid.push(u); continue; }
      if (room <= 0) { out.overflow.push(u); continue; }
      const r = await s.addItem(page.id, url, options, new Date().toISOString());
      if (r.duplicate) out.duplicates.push(u); else { out.added++; room--; }
    }
    res.json(out);
  } catch (err) { next(err); }
});

router.get('/:accountId/queue', async (req, res, next) => {
  try {
    const page = await ownedPage(req, res); if (!page) return;
    res.json(await store().listItems(page.id, req.query.limit));
  } catch (err) { next(err); }
});

async function ownedItem(req, res) {
  const s = store();
  const item = await s.getItem(req.params.itemId);
  if (!item) { res.status(404).json({ error: 'Item not found.' }); return null; }
  const page = await s.getAccount(item.account_id);
  if (page?.user_id && page.user_id !== req.headers['x-user-id']) { res.status(403).json({ error: 'Not your page.' }); return null; }
  return item;
}

router.delete('/item/:itemId', async (req, res, next) => {
  try { const item = await ownedItem(req, res); if (!item) return; await store().deleteItem(item.id); res.json({ message: 'Removed' }); } catch (err) { next(err); }
});
router.post('/item/:itemId/retry', async (req, res, next) => {
  try { const item = await ownedItem(req, res); if (!item) return; await store().retryItem(item.id); res.json({ message: 'Queued again' }); } catch (err) { next(err); }
});

// Post the next queued item now (ignores the schedule)
router.post('/:accountId/run', async (req, res, next) => {
  try {
    const page = await ownedPage(req, res); if (!page) return;
    const r = await getAutopilot().tick({ accountId: page.id, force: true });
    if (!r.started) return res.status(409).json({ error: r.reason === 'busy' ? 'Another post is being made right now. Try again in a few minutes.' : 'Nothing in the queue for this page.' });
    res.json({ message: 'Started. It will post in a few minutes.', started: r.started });
  } catch (err) { next(err); }
});

// Clear a pause after repeated failures
router.post('/:accountId/resume', async (req, res, next) => {
  try {
    const page = await ownedPage(req, res); if (!page) return;
    await store().resetFail(page.id);
    res.json(await pageSummary(store(), await store().getAccount(page.id)));
  } catch (err) { next(err); }
});

module.exports = router;
