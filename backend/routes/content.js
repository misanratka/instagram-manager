const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../models/db');
const { downloadVideo, getVideoMetadata } = require('../services/downloader');
const { transcribeVideo, segmentsToSRT } = require('../services/transcription');
const { generateContent, generateSubtitleLines } = require('../services/captionGenerator');
const { enhanceVideo, detectContentRect } = require('../services/videoProcessor');
const { renderCard } = require('../services/brandCard');
const logger = require('../services/logger');

const router = express.Router();

// Reads the optional caption fields from JSON bodies (bots/API) or multipart form fields (file upload).
// Every field is optional. Accepts snake_case or camelCase.
function readCaptionOptions(body = {}, isRepost = false) {
  const credit = body.credit_line ?? body.creditLine;
  return {
    instructions: body.instructions,
    mustInclude:  body.must_include ?? body.mustInclude,
    mentions:     body.mentions,
    hashtags:     body.hashtags,
    tosExact:       body.tos_exact ?? body.tosExact,
    tosMustInclude: body.tos_must_include ?? body.tosMustInclude,
    aiHashtags:   body.ai_hashtags ?? body.aiHashtags,
    // Credit line defaults ON for reposted links, OFF for your own uploaded clips
    creditLine:   (credit === undefined || credit === '') ? isRepost : credit
  };
}

// Instagram sometimes returns its login/generic page text instead of the real post caption.
function cleanMetaText(t = '') {
  const s = String(t || '').trim();
  if (!s) return '';
  if (/log in to instagram|create an account or log in|instagram photos and videos|^instagram$|^login/i.test(s) && s.length < 220) return '';
  return s;
}

// ── Background jobs + only one heavy job at a time ───────────────────────────
// Long steps (download, caption, render) would otherwise hold a web request open for minutes, which is fragile
// on a free server and on phones. With the header `x-async: 1` the route answers at once with a jobId and the
// work continues in the background; poll GET /api/content/job/:id. Without the header it behaves as before.
// Heavy jobs run one after another so two devices don't starve each other (and the server doesn't run out of memory).
const jobs = new Map();   // id -> { status: queued|running|done|error, queuedAt, startedAt, finishedAt, code, body }
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  for (const [id, j] of jobs) if ((j.finishedAt || j.queuedAt) < cutoff) jobs.delete(id);
}, 5 * 60 * 1000).unref();

let heavyChain = Promise.resolve();
let heavyWaiting = 0;
function runHeavy(fn) {
  heavyWaiting++;
  const p = heavyChain.then(() => { heavyWaiting--; return fn(); });
  heavyChain = p.catch(() => {});
  return p;
}

function heavy(handler) {
  return (req, res, next) => {
    if (req.headers['x-async'] !== '1') return runHeavy(() => handler(req, res, next)).catch(next);
    const id = uuidv4();
    const job = { status: 'queued', queuedAt: Date.now() };
    jobs.set(id, job);
    const fail = (err) => { job.finishedAt = Date.now(); job.status = 'error'; job.code = 500; job.body = { error: err?.message || 'Failed' }; };
    const fakeRes = {
      statusCode: 200,
      status(c) { this.statusCode = c; return this; },
      json(b) { job.finishedAt = Date.now(); job.code = this.statusCode; job.body = b; job.status = this.statusCode >= 400 ? 'error' : 'done'; return this; }
    };
    runHeavy(async () => { job.status = 'running'; job.startedAt = Date.now(); await handler(req, fakeRes, fail); })
      .catch(fail)
      .finally(() => { if (job.status === 'running') fail(new Error('Finished without a result')); });
    res.status(202).json({ jobId: id, waiting_behind: Math.max(0, heavyWaiting - 1) });
  };
}

router.get('/job/:id', (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j) return res.status(404).json({ error: 'That job is gone (the server may have restarted). Please try again.' });
  const base = {
    status: j.status,
    elapsed_s: Math.round(((j.finishedAt || Date.now()) - (j.startedAt || j.queuedAt)) / 1000),
    waiting_behind: j.status === 'queued' ? heavyWaiting : 0
  };
  if (j.status === 'done') return res.json({ ...base, result: j.body });
  if (j.status === 'error') return res.json({ ...base, error: j.body?.error || 'Failed' });
  res.json(base);
});

function srtToText(srt = '') {
  return String(srt || '').split(/\r?\n/)
    .filter(l => l.trim() && !/^\d+$/.test(l.trim()) && !/-->/.test(l)).join(' ');
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.resolve(process.env.UPLOAD_DIR || './uploads')),
  filename:    (req, file, cb) => cb(null, `upload_${uuidv4()}${path.extname(file.originalname)}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) return cb(null, true);
    cb(new Error('Only video files are accepted'));
  }
});

async function processVideo(videoPath, videoUrl, accountId, meta = {}, options = {}) {
  const account = accountId
    ? await getDB().get('SELECT * FROM accounts WHERE id=$1', [accountId])
    : null;

  // Skip transcription when there is no local video file
  const tPrep = Date.now();
  const [{ text: transcript, segments }, autoCrop] = await Promise.all([
    videoPath ? transcribeVideo(videoPath) : Promise.resolve({ text: '', segments: [] }),
    videoPath ? detectContentRect(videoPath).catch(() => null) : Promise.resolve(null)
  ]);
  logger.info(`[timing] transcribe + bar detection: ${Math.round((Date.now() - tPrep) / 1000)}s`);
  const srtContent = segmentsToSRT(segments);

  // Nothing to write from (no video, no transcript, no real post text): don't let the AI make something up.
  const hasSource = !!videoPath || !!(meta.description || '').trim() || !!(meta.title || '').trim() || !!(transcript || '').trim();
  if (!hasSource) {
    return { transcript, segments, srtContent, caption: '', hookText: '', onScreenSuggestions: [], captionSkipped: true, autoCrop };
  }

  const { caption, onScreenText } = await generateContent({
    videoPath,
    transcript,
    originalCaption: meta.description || '',
    videoTitle:      meta.title || '',
    captionStyle: account?.caption_style || 'casual',
    customPrompt: account?.caption_prompt,
    options
  });

  return { transcript, segments, srtContent, caption, hookText: onScreenText, onScreenSuggestions: [], autoCrop };
}

router.post('/process-url', heavy(async (req, res, next) => {
  try {
    const { url, account_id } = req.body;
    if (!url || !url.trim()) return res.status(400).json({ error: 'url is required' });

    const isInstagram = /instagram\.com/.test(url);
    const meta = await getVideoMetadata(url).catch(() => ({ title: '', description: '' }));
    meta.title = cleanMetaText(meta.title);
    meta.description = cleanMetaText(meta.description);

    // Always try to download the video; for Instagram, a failed download is non-fatal
    let videoFile = null;
    let downloadError = null;
    try {
      videoFile = await downloadVideo(url);
    } catch (downloadErr) {
      if (!isInstagram) throw downloadErr; // non-Instagram: download failure is a hard error
      downloadError = downloadErr.message;
      logger.warn('Instagram video download failed, continuing with caption only:', downloadErr.message);
    }

    const videoPath = videoFile ? videoFile.path : null;

    const { transcript, segments, srtContent, caption, hookText, onScreenSuggestions, captionSkipped, autoCrop } =
      await processVideo(videoPath, url, account_id, meta, readCaptionOptions(req.body, true));

    const postId = uuidv4();
    await getDB().run(
      `INSERT INTO posts (id, account_id, video_url, local_video_path, original_caption, generated_caption, hook_text, subtitles_srt, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft')`,
      [postId, account_id || null, url, videoPath, meta.description || '', caption, hookText, srtContent]
    );

    res.json({
      postId,
      videoUrl: videoFile ? videoFile.url : null,
      metadata: meta,
      transcript: (transcript || '').substring(0, 600),
      segments: segments || [],
      generatedCaption: caption,
      hookText,
      srtContent,
      onScreenSuggestions,
      instagramUrl: isInstagram && !videoFile ? url : null,
      downloadError: isInstagram && !videoFile ? downloadError : null,
      captionSkipped: !!captionSkipped,
      autoCrop: autoCrop || null,
    });
  } catch (err) { next(err); }
}));

router.post('/process-file', upload.single('video'), heavy(async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No video file uploaded' });
    const { account_id } = req.body;
    const videoPath = req.file.path;
    const videoUrl = `/uploads/${req.file.filename}`;

    const { transcript, segments, srtContent, caption, hookText, onScreenSuggestions, autoCrop } =
      await processVideo(videoPath, null, account_id, {}, readCaptionOptions(req.body, false));

    const postId = uuidv4();
    await getDB().run(
      `INSERT INTO posts (id, account_id, local_video_path, generated_caption, hook_text, subtitles_srt, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'draft')`,
      [postId, account_id || null, videoPath, caption, hookText, srtContent]
    );

    res.json({ postId, videoUrl, transcript: transcript.substring(0, 600), generatedCaption: caption, hookText, srtContent, onScreenSuggestions, autoCrop: autoCrop || null });
  } catch (err) { next(err); }
}));

// Renders the page card to a temp PNG. Returns { brand } or { error, status }.
async function buildBrandCard(req, accountId, text, dir, frame, mode, quality) {
  const plain = mode === 'text';   // text only: same layout without the page branding
  const account = accountId ? await getDB().get('SELECT * FROM accounts WHERE id=$1', [accountId]) : null;
  if (!account && !plain) return { status: 400, error: 'Pick a page first to use the card layout.' };
  const userId = req.headers['x-user-id'];
  if (account && userId && account.user_id && account.user_id !== userId) return { status: 403, error: 'Not your page.' };
  const t = String(text || '').trim();
  if (!t && !plain) return { status: 400, error: 'Add on-screen text first — it goes inside the card.' };
  const card = await renderCard({
    plain,
    name: account?.brand_name || account?.name,
    handle: account?.brand_handle || account?.username,
    verified: !!account?.brand_verified,
    avatar: account?.brand_avatar,
    text: t,
    theme: account?.brand_theme || 'dark',
    scale: frame?.cardScale
  });
  const cardPath = path.join(dir, `card_${uuidv4()}.png`);
  fs.writeFileSync(cardPath, card.buffer);
  return { brand: { cardPath, cardH: card.height, frame: frame || null, canvasColor: card.canvasColor, quality }, card };
}

// Live preview of the card (PNG as a data URL) for the review screen
router.post('/card-preview', async (req, res, next) => {
  try {
    const { account_id, text, scale, mode } = req.body || {};
    const plain = mode === 'text';
    const account = account_id ? await getDB().get('SELECT * FROM accounts WHERE id=$1', [account_id]) : null;
    if (!account && !plain) return res.status(400).json({ error: 'Pick a page first.' });
    const userId = req.headers['x-user-id'];
    if (account && userId && account.user_id && account.user_id !== userId) return res.status(403).json({ error: 'Not your page.' });
    const card = await renderCard({
      plain,
      name: account?.brand_name || account?.name,
      handle: account?.brand_handle || account?.username,
      verified: !!account?.brand_verified,
      avatar: account?.brand_avatar,
      text: String(text || '').trim() || (plain ? '' : 'Your on-screen text appears here'),
      theme: account?.brand_theme || 'dark',
      scale
    });
    res.json({ image: `data:image/png;base64,${card.buffer.toString('base64')}`, width: card.width, height: card.height, canvasColor: card.canvasColor });
  } catch (err) { next(err); }
});

router.post('/enhance/:postId', heavy(async (req, res, next) => {
  try {
    const { burnSubtitles = false, enhance = false, textOverlays = [], trim, adjustments, speed, cropRatio, subtitleStyle = 'standard', segments, brandCard, account_id } = req.body;
    const post = await getDB().get('SELECT * FROM posts WHERE id=$1', [req.params.postId]);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const inputPath = post.local_video_path;
    if (!inputPath) return res.status(400).json({ error: 'No local video to enhance' });
    const fs = require('fs');
    if (!fs.existsSync(inputPath)) return res.status(410).json({ error: 'Video file no longer on server — please process the URL again.' });

    const hasTrim = trim?.end > 0 || trim?.start > 0;
    const hasAdj  = adjustments && (adjustments.brightness !== 0 || adjustments.contrast !== 1 || adjustments.saturation !== 1);
    const hasSpeed = speed && speed !== 1;
    const wantsCard = !!brandCard?.enabled;
    if (!burnSubtitles && !enhance && textOverlays.length === 0 && !hasTrim && !hasAdj && !hasSpeed && !wantsCard)
      return res.status(400).json({ error: 'Select at least one editing or enhancement option' });

    // Page card layout (card on top, video below). Name/handle fall back to the connected account's own.
    let brand = null;
    if (wantsCard) {
      const built = await buildBrandCard(req, account_id || post.account_id, brandCard.text, path.dirname(inputPath), brandCard.frame, brandCard.mode, brandCard.quality);
      if (built.error) return res.status(built.status).json({ error: built.error });
      brand = built.brand;
    }

    let result;
    const tRender = Date.now();
    try {
      result = await enhanceVideo({ inputPath, srtContent: post.subtitles_srt || '', segments: segments || [], textOverlays, burnSubtitles, subtitleStyle, enhance, trim, adjustments, speed, cropRatio, brand });
    } finally {
      if (brand?.cardPath && fs.existsSync(brand.cardPath)) fs.unlinkSync(brand.cardPath);
      logger.info(`[timing] render: ${Math.round((Date.now() - tRender) / 1000)}s`);
    }
    await getDB().run('UPDATE posts SET enhanced_video_path=$1 WHERE id=$2', [result.path, post.id]);
    res.json({ enhancedVideoUrl: result.url, message: 'Video enhanced successfully' });
  } catch (err) { next(err); }
}));

// Attach a video file to an existing post (used when URL was Instagram — no download)
router.post('/attach-video/:postId', upload.single('video'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No video file' });
    const post = await getDB().get('SELECT id FROM posts WHERE id=$1', [req.params.postId]);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    await getDB().run('UPDATE posts SET local_video_path=$1 WHERE id=$2', [req.file.path, req.params.postId]);
    const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
    const autoCrop = await detectContentRect(req.file.path).catch(() => null);
    res.json({ videoUrl: `${base}/uploads/${req.file.filename}`, autoCrop });
  } catch (err) { next(err); }
});

router.put('/caption/:postId', async (req, res, next) => {
  try {
    const { caption, hookText } = req.body;
    const db = getDB();
    if (caption !== undefined)  await db.run('UPDATE posts SET final_caption=$1 WHERE id=$2', [caption, req.params.postId]);
    if (hookText !== undefined) await db.run('UPDATE posts SET hook_text=$1    WHERE id=$2', [hookText, req.params.postId]);
    res.json({ message: 'Updated' });
  } catch (err) { next(err); }
});

// Re-write the caption for an existing post without re-downloading/re-uploading the video.
// Body (all optional): account_id, instructions, must_include, mentions, hashtags, ai_hashtags, credit_line, tweak
router.post('/regenerate/:postId', async (req, res, next) => {
  try {
    const db = getDB();
    const post = await db.get('SELECT * FROM posts WHERE id=$1', [req.params.postId]);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const accountId = req.body.account_id || post.account_id;
    const account = accountId ? await db.get('SELECT * FROM accounts WHERE id=$1', [accountId]) : null;
    const fs = require('fs');
    const videoPath = post.local_video_path && fs.existsSync(post.local_video_path) ? post.local_video_path : null;

    if (!videoPath && !(post.original_caption || '').trim() && !(post.subtitles_srt || '').trim())
      return res.status(400).json({ error: 'Nothing to write the caption from yet. Upload the video first.' });

    const options = { ...readCaptionOptions(req.body, !!post.video_url), tweak: req.body.tweak };
    const { caption, onScreenText } = await generateContent({
      videoPath,
      transcript: srtToText(post.subtitles_srt),
      originalCaption: post.original_caption || '',
      videoTitle: '',
      captionStyle: account?.caption_style || 'casual',
      customPrompt: account?.caption_prompt,
      options
    });

    await db.run('UPDATE posts SET generated_caption=$1 WHERE id=$2', [caption, post.id]);
    res.json({ postId: post.id, generatedCaption: caption, hookText: onScreenText });
  } catch (err) { next(err); }
});

module.exports = router;
