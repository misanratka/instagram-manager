// Pre-publish safety gate.
//
// Scores a clip for "likely to be flagged as unoriginal / copyrighted" risk BEFORE it can be published.
//   level 'clear'   → can publish (manual or autopilot)
//   level 'review'  → held: manual posts need an explicit confirm, autopilot/scheduler never post it
//   level 'blocked' → never publishes
//
// This reduces risk, it cannot guarantee safety: Content ID / Rights Manager claims are not visible to us.
// Signals used: source metadata (title, caption, uploader, track, license), ffprobe file tags,
// a blocklist of broadcasters / leagues / labels / events, and a Gemini look at a few frames.
const { execFile } = require('child_process');
const logger = require('./logger');

const BLOCK_AT = 30;   // 30+ = risky = never posts (no review tier)
const REVIEW_AT = 30;

// Edit these lists freely. Matched as whole words, case-insensitive.
const HARD_TERMS = [
  // sports leagues + broadcasters
  'nba', 'nfl', 'mlb', 'nhl', 'ufc', 'wwe', 'fifa', 'uefa', 'premier league', 'champions league', 'espn', 'sky sports', 'bein sports', 'dazn',
  // full-length / official uploads
  'official music video', 'vevo', 'full movie', 'full episode', 'full match', 'full concert', 'full set', 'official trailer'
];
const MEDIUM_TERMS = [
  // festivals / awards / big live events
  'coachella', 'glastonbury', 'tomorrowland', 'lollapalooza', 'met gala', 'grammys', 'oscars', 'emmys', 'vmas', 'super bowl', 'halftime show', 'billboard music awards',
  // studios / networks / streamers
  'netflix', 'hbo', 'disney', 'marvel', 'warner bros', 'universal pictures', 'paramount', 'sony pictures', 'prime video', 'apple tv', 'nickelodeon', 'cartoon network', 'mtv', 'bbc', 'cnn',
  // labels
  'universal music', 'sony music', 'warner records', 'atlantic records', 'def jam', 'republic records', 'interscope'
];
// When a festival/event name appears together with one of these it is the official stream, not a fan clip.
const OFFICIAL_STREAM = /\b(live ?stream|livestream|official|full set|broadcast|presented by)\b/i;
const OTHER_APP_TAGS = /\b(tiktok|douyin|snapchat|likee|kuaishou|capcut|vm\.tiktok)\b/i;

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const termRe = (t) => new RegExp(`(^|[^a-z0-9])${esc(t).replace(/\s+/g, '\\s+')}([^a-z0-9]|$)`, 'i');
const HARD_RE = HARD_TERMS.map(t => [t, termRe(t)]);
const MED_RE = MEDIUM_TERMS.map(t => [t, termRe(t)]);

function levelFor(score) { return score >= BLOCK_AT ? 'blocked' : 'clear'; }

// ── credit detection ─────────────────────────────────────────────────────────
const CREDIT_RE = /(?:credits?|cr|via|source|video by|clip by|filmed by|footage by|from|courtesy of|dc|📹|🎥|🎬|©)\s*[:\-–—]?\s*@([A-Za-z0-9._]{2,30})/i;
const IG_DESC_HANDLE = /[-–—]\s+@?([A-Za-z0-9._]{2,30})\s+on\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4}/;

/** The handle to credit for a reposted clip. Prefers a credit written in the source caption, then the posting account. */
function extractCredit(meta = {}, url = '') {
  const text = [meta.description, meta.title].filter(Boolean).join('\n');
  const c = text.match(CREDIT_RE);
  if (c) return { handle: c[1].replace(/\.+$/, ''), via: 'caption' };
  const d = String(meta.description || '').match(IG_DESC_HANDLE);
  if (d) return { handle: d[1].replace(/\.+$/, ''), via: 'source' };
  const u = String(meta.uploader_id || '').replace(/^@/, '');
  if (/^[A-Za-z0-9._]{2,30}$/.test(u)) return { handle: u, via: 'source' };
  return null;
}

// ── metadata signals ─────────────────────────────────────────────────────────
function probeTags(videoPath) {
  return new Promise((resolve) => {
    if (!videoPath) return resolve('');
    execFile('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', videoPath], { timeout: 15000, maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
      if (err) return resolve('');
      try {
        const j = JSON.parse(out);
        const vals = [];
        const grab = (tags) => Object.values(tags || {}).forEach(v => vals.push(String(v)));
        grab(j.format?.tags);
        (j.streams || []).forEach(s => grab(s.tags));
        resolve(vals.join(' | '));
      } catch { resolve(''); }
    });
  });
}

function metadataSignals(meta = {}, fileTags = '') {
  const hits = [];
  const text = [meta.title, meta.description, meta.uploader, meta.channel, meta.track, meta.artist, (meta.tags || []).join(' '), fileTags].filter(Boolean).join('\n');
  if (text) {
    for (const [t, re] of HARD_RE) if (re.test(text)) hits.push({ points: 70, why: `Source mentions “${t}” (broadcast / official content)` });
    for (const [t, re] of MED_RE) {
      if (!re.test(text)) continue;
      hits.push(OFFICIAL_STREAM.test(text)
        ? { points: 70, why: `Looks like an official stream of “${t}”` }
        : { points: 35, why: `Source mentions “${t}” (rights-holder content)` });
    }
  }
  if (OTHER_APP_TAGS.test(fileTags) || OTHER_APP_TAGS.test(meta.uploader || '')) hits.push({ points: 30, why: 'File or source carries another app’s watermark/tag' });
  if (meta.track || meta.artist) hits.push({ points: 20, why: `Licensed music detected (${[meta.artist, meta.track].filter(Boolean).join(' – ')})` });
  if (meta.license && !/creative commons|cc[- ]by/i.test(meta.license)) hits.push({ points: 10, why: `Source license: ${meta.license}` });
  if (Number(meta.duration) > 180) hits.push({ points: 20, why: 'Long clip (over 3 minutes) — likely a full upload' });
  return hits;
}

// ── vision signals (Gemini, a few frames) ────────────────────────────────────
async function visionSignals(videoPath) {
  if (!videoPath || !process.env.GEMINI_API_KEY) return [];
  try {
    const { extractFrames } = require('./videoProcessor');
    const all = await extractFrames(videoPath, 6);   // shared with the caption writer (one ffmpeg run)
    const frames = all.length > 4 ? [0, 1, 3, 5].map(i => all[i]).filter(Boolean) : all;
    if (!frames.length) return [];
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const model = new GoogleGenerativeAI(process.env.GEMINI_API_KEY).getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' });
    const r = await model.generateContent([
      ...frames.map(data => ({ inlineData: { mimeType: 'image/jpeg', data } })),
      { text: 'These are frames from one video. Report ONLY what is clearly visible. Do not identify people by face. Return ONLY JSON: {"watermark_or_logo":"name or empty","broadcast_graphics":false,"sports_footage":false,"tv_or_movie_footage":false,"named_live_event":"name or empty","other_app_watermark":"tiktok|snapchat|other|empty","concert_or_performance":false}' }
    ]);
    const m = r.response.text().replace(/```json|```/g, '').match(/\{[\s\S]*\}/);
    if (!m) return [];
    const v = JSON.parse(m[0]);
    const out = [];
    if (v.broadcast_graphics) out.push({ points: 40, why: 'Broadcast graphics visible (scorebug / channel overlay)' });
    if (v.sports_footage) out.push({ points: 45, why: 'Sports broadcast footage' });
    if (v.tv_or_movie_footage) out.push({ points: 25, why: 'Looks like TV or movie footage' });
    if (v.named_live_event) out.push({ points: 30, why: `Live event visible: ${String(v.named_live_event).slice(0, 60)}` });
    if (v.watermark_or_logo) out.push({ points: 30, why: `Watermark/logo visible: ${String(v.watermark_or_logo).slice(0, 60)}` });
    if (v.other_app_watermark) out.push({ points: 30, why: `${String(v.other_app_watermark).slice(0, 30)} watermark visible` });
    if (v.concert_or_performance) out.push({ points: 15, why: 'Live music performance (audio is likely licensed)' });
    return out;
  } catch (e) {
    logger.warn('Guard vision check skipped: ' + e.message);
    return [];
  }
}

function build(hits, credit) {
  // Strongest signals first; sum is capped so one thing can't exceed 100
  const sorted = [...hits].sort((a, b) => b.points - a.points);
  const seen = new Set();
  const reasons = [];
  let score = 0;
  for (const h of sorted) { if (seen.has(h.why)) continue; seen.add(h.why); reasons.push(h.why); score += h.points; }
  score = Math.min(100, score);
  return { level: levelFor(score), score, reasons, credit: credit || null };
}

/** Main entry. Never throws: a failed check returns 'clear' with a note rather than stopping posts. */
async function assessClip({ videoPath, meta = {}, url = '', isRepost = false, credit = null }) {
  try {
    const [fileTags, vision] = await Promise.all([probeTags(videoPath), visionSignals(videoPath)]);
    const hits = [...metadataSignals(meta, fileTags), ...vision];
    return build(hits, credit);
  } catch (e) {
    logger.warn('Guard check failed, not blocking: ' + e.message);
    return { level: 'clear', score: 0, reasons: [], credit: credit || null };
  }
}

/** Add one more reason to an existing result (e.g. the on-screen text check) and re-level it. */
function addReason(guard, why, points) {
  if (!guard) return guard;
  const reasons = [...(guard.reasons || [])];
  if (!reasons.includes(why)) reasons.push(why);
  const score = Math.min(100, (guard.score || 0) + points);
  return { ...guard, reasons, score, level: levelFor(score) };
}

function parseReasons(row) {
  try { const r = JSON.parse(row?.guard_reasons || '[]'); return Array.isArray(r) ? r : []; } catch { return []; }
}

/** For publish/schedule routes and the scheduler. Returns null when allowed. */
function gateDecision(row, body = {}) {
  const level = row?.guard_level;
  if (!level || level === 'clear') return null;
  const why = parseReasons(row).join('; ') || 'risk detected';
  return { status: 422, error: `Blocked by the safety check: ${why}` };   // any non-clear result (incl. old 'review' rows) does not post
}

module.exports = { assessClip, extractCredit, addReason, gateDecision, metadataSignals, build, levelFor, HARD_TERMS, MEDIUM_TERMS, BLOCK_AT, REVIEW_AT };
