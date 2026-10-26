// Autopilot: posts queued links to a page on a schedule, with no manual steps.
//
// Built for Render's free tier:
//  - everything is "just in time": at the posting time the clip is downloaded, rendered and posted in one go,
//    so nothing waits on the server's temporary disk (which is wiped on restarts)
//  - the queue and settings live in the database
//  - only ONE job runs at a time (0.5 GB RAM, slow CPU)
//  - an interrupted job (restart/spin-down) goes back to the queue
//  - a page that fails 3 times in a row is paused instead of retrying forever
const crypto = require('crypto');
const logger = require('./logger');

const MAX_ATTEMPTS = 2;                 // tries per queued item
const FAIL_PAUSE_AT = 3;                // failed items in a row before the page is paused
const SLOT_EXPIRY_MS = 4 * 3600 * 1000; // a missed slot older than this is skipped, not caught up
const PUBLISH_WAIT_MS = 14 * 60 * 1000;

// ── time helpers (IANA time zones via Intl, no extra packages) ───────────────
function safeTz(tz) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return 'UTC'; }
}
function tzOffsetMs(date, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p = Object.fromEntries(dtf.formatToParts(date).map(x => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}
function localYMD(date, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  const p = Object.fromEntries(dtf.formatToParts(date).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day };
}
function localToUtc(y, m, d, hh, mm, tz) {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let off = tzOffsetMs(new Date(guess), tz);
  off = tzOffsetMs(new Date(guess - off), tz);
  return new Date(guess - off);
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const toInt = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.round(Number(v)) : d);

/** Today's posting times for a page: N evenly spaced slots inside the window, nudged ±10 min so posts don't look robotic. */
function computeSlots(page, now) {
  const tz = safeTz(page.ap_tz || 'UTC');
  const n = clamp(toInt(page.ap_per_day, 2), 1, 8);
  const start = clamp(toInt(page.ap_start_hour, 9), 0, 23);
  const end = clamp(toInt(page.ap_end_hour, 22), start + 1, 24);
  const { y, m, d } = localYMD(now, tz);
  const startMin = start * 60, span = (end - start) * 60;
  const slots = [];
  for (let i = 0; i < n; i++) {
    const jitter = (parseInt(crypto.createHash('sha1').update(`${page.id}|${y}-${m}-${d}|${i}`).digest('hex').slice(0, 6), 16) % 21) - 10;
    const min = clamp(Math.round(startMin + ((i + 0.5) * span) / n + jitter), startMin, end * 60 - 1);
    slots.push(localToUtc(y, m, d, Math.floor(min / 60), min % 60, tz));
  }
  slots.sort((a, b) => a - b);
  return { slots, dayStart: localToUtc(y, m, d, 0, 0, tz), tz };
}

/** Index of the slot that is due now, or -1. `done` = posts already made/started today. */
function dueIndex(slots, now, done) {
  const expired = slots.filter(t => now - t > SLOT_EXPIRY_MS).length;
  const idx = Math.max(done, expired);
  return idx < slots.length && slots[idx] <= now ? idx : -1;
}

// ── links & options ──────────────────────────────────────────────────────────
const TRACKING = /^(utm_|igsh|igshid|si$|fbclid|feature$|ref$)/i;
function normalizeUrl(raw) {
  try {
    const u = new URL(String(raw).trim());
    if (!/^https?:$/.test(u.protocol)) return null;
    u.hash = '';
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
    if (/instagram\.com$/.test(u.hostname)) u.search = '';
    u.pathname = u.pathname.replace(/\/+$/, '') || '/';
    return u.toString();
  } catch { return null; }
}

const list = (v, splitter) => (v === undefined || v === null ? [] : (Array.isArray(v) ? v : String(v).split(splitter))).map(x => String(x).trim()).filter(Boolean);

/** Page defaults + per-item overrides (campaign rules go in the item's options). */
function mergeOptions(page, itemOptions) {
  const o = itemOptions || {};
  return {
    instructions: o.instructions,
    must_include: o.must_include,
    mentions: o.mentions,
    hashtags: o.hashtags,
    ai_hashtags: o.ai_hashtags,
    tos_exact: o.tos_exact,
    tos_must_include: o.tos_must_include,
    credit_line: o.credit_line !== undefined ? o.credit_line : !!(page.ap_credit_line ?? 1),
    layout: o.layout === 'text' || o.layout === 'card' ? o.layout : (page.ap_layout === 'text' ? 'text' : 'card')
  };
}

/** What the result must contain. Returns a list of missing items (empty = OK). */
function verifyRules({ caption, hookText }, opts) {
  const cap = String(caption || ''), hook = String(hookText || '');
  const missing = [];
  if (!cap.trim()) missing.push('caption is empty');
  for (const p of list(opts.must_include, /\n+/)) if (!cap.includes(p)) missing.push(`caption phrase "${p}"`);
  for (const h of list(opts.mentions, /[\s,]+/)) {
    const tag = '@' + h.replace(/^@+/, '');
    if (!cap.toLowerCase().includes(tag.toLowerCase())) missing.push(`mention ${tag}`);
  }
  for (const t of list(opts.hashtags, /[\s,]+/)) {
    const tag = '#' + t.replace(/^#+/, '');
    if (!cap.toLowerCase().includes(tag.toLowerCase())) missing.push(`hashtag ${tag}`);
  }
  const exact = String(opts.tos_exact || '').trim();
  if (exact) { if (hook.trim() !== exact) missing.push('exact on-screen text'); }
  else for (const p of list(opts.tos_must_include, /\n+/)) if (!hook.includes(p)) missing.push(`on-screen text "${p}"`);
  return missing;
}

function fullFrame(autoCrop) {
  return autoCrop
    ? { top: autoCrop.y, bottom: autoCrop.y + autoCrop.h, left: autoCrop.x, right: autoCrop.x + autoCrop.w, zoom: 1, offsetY: 0, cardScale: 1 }
    : { top: 0, bottom: 1, left: 0, right: 1, zoom: 1, offsetY: 0, cardScale: 1 };
}

// ── the engine (dependencies are injected so it can be tested) ───────────────
function createAutopilot({ store, call, now = () => new Date(), sleep = (ms) => new Promise(r => setTimeout(r, ms)), pollMs = 20000 }) {
  let busy = false;

  async function runItem(item, page) {
    const userId = page.user_id || undefined;
    const opts = mergeOptions(page, safeJson(item.options));
    const reqOpts = {};
    for (const k of ['instructions', 'must_include', 'mentions', 'hashtags', 'ai_hashtags', 'tos_exact', 'tos_must_include', 'credit_line']) {
      if (opts[k] !== undefined && opts[k] !== null && opts[k] !== '') reqOpts[k] = opts[k];
    }

    // 1. download + transcribe + write caption and on-screen text
    const proc = await call('POST', '/api/content/process-url', { url: item.url, account_id: page.id, ...reqOpts }, userId, 5 * 60 * 1000);
    if (proc.instagramUrl || proc.captionSkipped) {
      throw new Error('Download blocked' + (proc.downloadError ? `: ${String(proc.downloadError).split('\n')[0]}` : ''));
    }
    await store.setPostId(item.id, proc.postId);

    // 2. rule check (campaign lines etc.). Rewrite up to twice, then refuse to post.
    let caption = proc.generatedCaption, hook = proc.hookText;
    for (let i = 0; ; i++) {
      const missing = verifyRules({ caption, hookText: hook }, opts);
      if (!missing.length) break;
      if (i >= 2) throw new Error('Rule check failed. Missing: ' + missing.join('; '));
      const r = await call('POST', `/api/content/regenerate/${proc.postId}`, { account_id: page.id, ...reqOpts }, userId, 4 * 60 * 1000);
      caption = r.generatedCaption; hook = r.hookText;
    }

    // 3. render the layout (card on top, video below)
    let mode = opts.layout;
    if (mode === 'card' && !String(hook || '').trim()) mode = 'text';   // no text for the card → crop only
    await call('POST', `/api/content/enhance/${proc.postId}`,
      { account_id: page.id, brandCard: { enabled: true, mode, text: hook || '', frame: fullFrame(proc.autoCrop) } }, userId, 10 * 60 * 1000);

    // 4. publish, then wait for the result
    await call('POST', `/api/posts/${proc.postId}/publish`, { account_id: page.id, caption, hookText: hook }, userId, 60 * 1000);
    const deadline = now().getTime() + PUBLISH_WAIT_MS;
    for (;;) {
      await sleep(pollMs);
      const p = await store.getPost(proc.postId);
      if (p?.status === 'posted') { await store.removeFiles(p); return { postId: proc.postId }; }
      if (p?.status === 'failed') throw new Error(p.error_message || 'Publishing failed');
      if (now().getTime() > deadline) throw new Error('Publishing took too long');
    }
  }

  async function finishItem(item, page) {
    try {
      const r = await runItem(item, page);
      await store.markPosted(item.id, r.postId, now().toISOString());
      await store.resetFail(page.id);
      logger.info(`Autopilot posted ${item.url} to ${page.username || page.id}`);
    } catch (err) {
      const msg = String(err.message || err).slice(0, 500);
      const attempts = (item.attempts || 0) + 1;
      logger.warn(`Autopilot item failed (${attempts}/${MAX_ATTEMPTS}) for ${page.username || page.id}: ${msg}`);
      if (attempts < MAX_ATTEMPTS) {
        await store.markRetry(item.id, msg);
      } else {
        await store.markFailed(item.id, msg, now().toISOString());
        const streak = await store.bumpFail(page.id);
        if (streak >= FAIL_PAUSE_AT) await store.pause(page.id, `Paused after ${streak} failed posts in a row. Last error: ${msg.slice(0, 200)}`);
      }
    }
  }

  /** Looks for ONE due page and starts its next queued item in the background. */
  async function tick({ accountId, force = false } = {}) {
    if (busy) return { started: null, reason: 'busy' };
    const t = now();
    const pages = await store.listPages(accountId, { enabledOnly: !force });
    for (const page of pages) {
      if (page.ap_paused_reason && !force) continue;
      if (!force) {
        const { slots, dayStart } = computeSlots(page, t);
        const done = await store.countToday(page.id, dayStart.toISOString());
        if (dueIndex(slots, t, done) < 0) continue;
      }
      const item = await store.nextQueued(page.id);
      if (!item) continue;
      busy = true;
      const attemptsBefore = item.attempts || 0;   // read before markProcessing counts this try
      await store.markProcessing(item.id, t.toISOString());
      const job = finishItem({ ...item, attempts: attemptsBefore }, page).finally(() => { busy = false; });
      return { started: { accountId: page.id, itemId: item.id }, job };
    }
    return { started: null, reason: 'nothing due' };
  }

  /** After a restart nothing can still be running: put interrupted items back. */
  async function recoverStale() {
    for (const item of await store.staleProcessing()) {
      const attempts = item.attempts || 1;
      if (attempts >= MAX_ATTEMPTS) await store.markFailed(item.id, 'Interrupted by a restart', now().toISOString());
      else await store.markRetry(item.id, 'Interrupted by a restart');
    }
  }

  return { tick, recoverStale, runItem, isBusy: () => busy };
}

function safeJson(s) { try { return s ? JSON.parse(s) : {}; } catch { return {}; } }

// ── production wiring ────────────────────────────────────────────────────────
let instance = null;
function getAutopilot() {
  if (!instance) {
    const axios = require('axios');
    const { getDB } = require('../models/db');
    const { createStore } = require('./autopilotStore');
    const call = async (method, urlPath, body, userId, timeout) => {
      const res = await axios({
        method, url: `http://127.0.0.1:${process.env.PORT || 3001}${urlPath}`, data: body, timeout,
        headers: { 'Content-Type': 'application/json', ...(userId ? { 'x-user-id': userId } : {}) },
        validateStatus: () => true, maxBodyLength: Infinity
      });
      if (res.status >= 400) throw new Error(res.data?.error || `HTTP ${res.status}`);
      return res.data;
    };
    instance = createAutopilot({ store: createStore(getDB()), call });
  }
  return instance;
}

function startAutopilot() {
  const cron = require('node-cron');
  const ap = getAutopilot();
  ap.recoverStale().catch(err => logger.warn('Autopilot recovery failed: ' + err.message));
  const run = () => ap.tick().catch(err => logger.warn('Autopilot tick failed: ' + err.message));
  cron.schedule('*/10 * * * *', run);
  setTimeout(run, 60 * 1000);
  logger.info('Autopilot ready (checks every 10 minutes)');
}

module.exports = { createAutopilot, getAutopilot, startAutopilot, computeSlots, dueIndex, normalizeUrl, mergeOptions, verifyRules, fullFrame, safeTz, localToUtc, localYMD, SLOT_EXPIRY_MS, MAX_ATTEMPTS, FAIL_PAUSE_AT };
