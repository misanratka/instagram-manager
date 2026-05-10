const express = require('express');
const path = require('path');
const { getDB } = require('../models/db');
const { postReel } = require('../services/instagramPoster');
const logger = require('../services/logger');

const router = express.Router();

function getVideoPublicUrl(post) {
  const localPath = post.enhanced_video_path || post.local_video_path;
  if (localPath) {
    const base = process.env.PUBLIC_URL;
    if (!base) throw new Error('PUBLIC_URL is not set in .env. Instagram needs a public HTTPS URL to fetch the video. Use ngrok for local dev.');
    return `${base.replace(/\/$/, '')}/uploads/${path.basename(localPath)}`;
  }
  if (post.video_url && post.video_url.startsWith('http')) return post.video_url;
  throw new Error('No video URL available for this post');
}

router.get('/', async (req, res, next) => {
  try {
    const { account_id, status } = req.query;
    let sql = `SELECT p.*, a.name as account_name, a.username
               FROM posts p LEFT JOIN accounts a ON p.account_id = a.id WHERE 1=1`;
    const params = [];
    if (account_id) { sql += ` AND p.account_id=$${params.length + 1}`; params.push(account_id); }
    if (status)     { sql += ` AND p.status=$${params.length + 1}`;     params.push(status); }
    sql += ' ORDER BY p.created_at DESC';
    res.json(await getDB().all(sql, params));
  } catch (err) { next(err); }
});

router.post('/:id/publish', async (req, res, next) => {
  try {
    const { account_id, caption, hookText } = req.body;
    const db = getDB();

    if (account_id)           await db.run('UPDATE posts SET account_id=$1    WHERE id=$2', [account_id, req.params.id]);
    if (caption !== undefined) await db.run('UPDATE posts SET final_caption=$1 WHERE id=$2', [caption, req.params.id]);
    if (hookText !== undefined) await db.run('UPDATE posts SET hook_text=$1    WHERE id=$2', [hookText, req.params.id]);

    const post = await db.get(
      `SELECT p.*, a.ig_user_id, a.access_token
       FROM posts p JOIN accounts a ON p.account_id = a.id
       WHERE p.id=$1`,
      [req.params.id]
    );
    if (!post) return res.status(400).json({ error: 'Post not found, or no account selected for this post' });

    const videoUrl = getVideoPublicUrl(post);
    const finalCaption = post.final_caption || post.generated_caption || '';
    const mediaId = await postReel(post.ig_user_id, post.access_token, videoUrl, finalCaption);

    await db.run(
      `UPDATE posts SET status='posted', posted_at=$1, ig_media_id=$2, error_message=NULL WHERE id=$3`,
      [new Date().toISOString(), mediaId, post.id]
    );
    res.json({ message: 'Reel posted successfully!', ig_media_id: mediaId });
  } catch (err) { next(err); }
});

router.post('/:id/schedule', async (req, res, next) => {
  try {
    const { scheduled_at, account_id, caption } = req.body;
    if (!scheduled_at) return res.status(400).json({ error: 'scheduled_at is required' });

    const db = getDB();
    if (account_id)           await db.run('UPDATE posts SET account_id=$1    WHERE id=$2', [account_id, req.params.id]);
    if (caption !== undefined) await db.run('UPDATE posts SET final_caption=$1 WHERE id=$2', [caption, req.params.id]);
    await db.run(`UPDATE posts SET status='scheduled', scheduled_at=$1 WHERE id=$2`, [scheduled_at, req.params.id]);

    res.json({ message: 'Post scheduled', scheduled_at });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await getDB().run('DELETE FROM posts WHERE id=$1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
