const express = require('express');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../models/db');
const { downloadVideo, getVideoMetadata } = require('../services/downloader');
const { transcribeVideo, segmentsToSRT } = require('../services/transcription');
const { generateContent, generateSubtitleLines } = require('../services/captionGenerator');
const { enhanceVideo } = require('../services/videoProcessor');
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
    aiHashtags:   body.ai_hashtags ?? body.aiHashtags,
    // Credit line defaults ON for reposted links, OFF for your own uploaded clips
    creditLine:   (credit === undefined || credit === '') ? isRepost : credit
  };
}

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
  const { text: transcript, segments } = videoPath
    ? await transcribeVideo(videoPath)
    : { text: '', segments: [] };
  const srtContent = segmentsToSRT(segments);

  const { caption, onScreenText } = await generateContent({
    videoPath,
    transcript,
    originalCaption: meta.description || '',
    videoTitle:      meta.title || '',
    captionStyle: account?.caption_style || 'casual',
    customPrompt: account?.caption_prompt,
    options
  });

  return { transcript, segments, srtContent, caption, hookText: onScreenText, onScreenSuggestions: [] };
}

router.post('/process-url', async (req, res, next) => {
  try {
    const { url, account_id } = req.body;
    if (!url || !url.trim()) return res.status(400).json({ error: 'url is required' });

    const isInstagram = /instagram\.com/.test(url);
    const meta = await getVideoMetadata(url).catch(() => ({ title: '', description: '' }));

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

    const { transcript, segments, srtContent, caption, hookText, onScreenSuggestions } =
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
    });
  } catch (err) { next(err); }
});

router.post('/process-file', upload.single('video'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No video file uploaded' });
    const { account_id } = req.body;
    const videoPath = req.file.path;
    const videoUrl = `/uploads/${req.file.filename}`;

    const { transcript, segments, srtContent, caption, hookText, onScreenSuggestions } =
      await processVideo(videoPath, null, account_id, {}, readCaptionOptions(req.body, false));

    const postId = uuidv4();
    await getDB().run(
      `INSERT INTO posts (id, account_id, local_video_path, generated_caption, hook_text, subtitles_srt, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'draft')`,
      [postId, account_id || null, videoPath, caption, hookText, srtContent]
    );

    res.json({ postId, videoUrl, transcript: transcript.substring(0, 600), generatedCaption: caption, hookText, srtContent, onScreenSuggestions });
  } catch (err) { next(err); }
});

router.post('/enhance/:postId', async (req, res, next) => {
  try {
    const { burnSubtitles = false, enhance = false, textOverlays = [], trim, adjustments, speed, cropRatio, subtitleStyle = 'standard', segments } = req.body;
    const post = await getDB().get('SELECT * FROM posts WHERE id=$1', [req.params.postId]);
    if (!post) return res.status(404).json({ error: 'Post not found' });

    const inputPath = post.local_video_path;
    if (!inputPath) return res.status(400).json({ error: 'No local video to enhance' });
    const fs = require('fs');
    if (!fs.existsSync(inputPath)) return res.status(410).json({ error: 'Video file no longer on server — please process the URL again.' });

    const hasTrim = trim?.end > 0 || trim?.start > 0;
    const hasAdj  = adjustments && (adjustments.brightness !== 0 || adjustments.contrast !== 1 || adjustments.saturation !== 1);
    const hasSpeed = speed && speed !== 1;
    if (!burnSubtitles && !enhance && textOverlays.length === 0 && !hasTrim && !hasAdj && !hasSpeed)
      return res.status(400).json({ error: 'Select at least one editing or enhancement option' });

    const result = await enhanceVideo({ inputPath, srtContent: post.subtitles_srt || '', segments: segments || [], textOverlays, burnSubtitles, subtitleStyle, enhance, trim, adjustments, speed, cropRatio });
    await getDB().run('UPDATE posts SET enhanced_video_path=$1 WHERE id=$2', [result.path, post.id]);
    res.json({ enhancedVideoUrl: result.url, message: 'Video enhanced successfully' });
  } catch (err) { next(err); }
});

// Attach a video file to an existing post (used when URL was Instagram — no download)
router.post('/attach-video/:postId', upload.single('video'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No video file' });
    const post = await getDB().get('SELECT id FROM posts WHERE id=$1', [req.params.postId]);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    await getDB().run('UPDATE posts SET local_video_path=$1 WHERE id=$2', [req.file.path, req.params.postId]);
    const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
    res.json({ videoUrl: `${base}/uploads/${req.file.filename}` });
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
