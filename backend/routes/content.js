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

async function processVideo(videoPath, videoUrl, accountId) {
  const account = accountId
    ? await getDB().get('SELECT * FROM accounts WHERE id=$1', [accountId])
    : null;

  const { text: transcript, segments } = await transcribeVideo(videoPath);
  const srtContent = segmentsToSRT(segments);

  const { caption, onScreenText } = await generateContent({
    transcript,
    captionStyle: account?.caption_style || 'casual',
    customPrompt: account?.caption_prompt
  });

  return { transcript, segments, srtContent, caption, hookText: onScreenText, onScreenSuggestions: [] };
}

router.post('/process-url', async (req, res, next) => {
  try {
    const { url, account_id } = req.body;
    if (!url || !url.trim()) return res.status(400).json({ error: 'url is required' });

    const meta = await getVideoMetadata(url).catch(() => ({ title: '', description: '' }));
    const videoFile = await downloadVideo(url);

    const { transcript, segments, srtContent, caption, hookText, onScreenSuggestions } =
      await processVideo(videoFile.path, url, account_id);

    const account = account_id
      ? await getDB().get('SELECT * FROM accounts WHERE id=$1', [account_id])
      : null;

    let captionWithMeta = caption;
    let hookWithMeta = hookText;
    if (!captionWithMeta) {
      const generated = await generateContent({
        transcript, originalCaption: meta.description, videoTitle: meta.title,
        captionStyle: account?.caption_style || 'casual', customPrompt: account?.caption_prompt
      });
      captionWithMeta = generated.caption;
      hookWithMeta = generated.onScreenText || hookText;
    }

    const postId = uuidv4();
    await getDB().run(
      `INSERT INTO posts (id, account_id, video_url, local_video_path, original_caption, generated_caption, hook_text, subtitles_srt, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'draft')`,
      [postId, account_id || null, url, videoFile.path, meta.description || '', captionWithMeta, hookWithMeta, srtContent]
    );

    res.json({ postId, videoUrl: videoFile.url, metadata: meta, transcript: transcript.substring(0, 600), generatedCaption: captionWithMeta, hookText: hookWithMeta, srtContent, onScreenSuggestions });
  } catch (err) { next(err); }
});

router.post('/process-file', upload.single('video'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No video file uploaded' });
    const { account_id } = req.body;
    const videoPath = req.file.path;
    const videoUrl = `/uploads/${req.file.filename}`;

    const { transcript, segments, srtContent, caption, hookText, onScreenSuggestions } =
      await processVideo(videoPath, null, account_id);

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
    const { burnSubtitles = false, enhance = false, textOverlays = [], trim, adjustments, speed, cropRatio } = req.body;
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

    const result = await enhanceVideo({ inputPath, srtContent: post.subtitles_srt || '', textOverlays, burnSubtitles, enhance, trim, adjustments, speed, cropRatio });
    await getDB().run('UPDATE posts SET enhanced_video_path=$1 WHERE id=$2', [result.path, post.id]);
    res.json({ enhancedVideoUrl: result.url, message: 'Video enhanced successfully' });
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

module.exports = router;
