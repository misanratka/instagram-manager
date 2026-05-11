const cron = require('node-cron');
const path = require('path');
const { getDB } = require('../models/db');
const { postReel } = require('./instagramPoster');
const logger = require('./logger');

function getVideoPublicUrl(post) {
  const fs = require('fs');
  const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '');

  for (const localPath of [post.enhanced_video_path, post.local_video_path]) {
    if (localPath && fs.existsSync(localPath)) {
      if (!base) throw new Error('PUBLIC_URL env var is not set');
      return `${base}/uploads/${path.basename(localPath)}`;
    }
  }

  if (post.video_url && post.video_url.startsWith('http')) return post.video_url;
  throw new Error(`Video file missing for post ${post.id} — skipping`);
}

function startScheduler() {
  cron.schedule('* * * * *', async () => {
    let db;
    try { db = getDB(); } catch { return; }

    const now = new Date().toISOString();
    const duePosts = await db.all(
      `SELECT p.*, a.ig_user_id, a.access_token
       FROM posts p JOIN accounts a ON p.account_id = a.id
       WHERE p.status = 'scheduled' AND p.scheduled_at <= $1`,
      [now]
    );

    for (const post of duePosts) {
      try {
        const videoUrl = getVideoPublicUrl(post);
        const caption = post.final_caption || post.generated_caption || '';
        const mediaId = await postReel(post.ig_user_id, post.access_token, videoUrl, caption);
        await db.run(
          `UPDATE posts SET status='posted', posted_at=$1, ig_media_id=$2, error_message=NULL WHERE id=$3`,
          [new Date().toISOString(), mediaId, post.id]
        );
        logger.info(`Scheduled post published: ${post.id} → ${mediaId}`);
      } catch (err) {
        await db.run(
          `UPDATE posts SET status='failed', error_message=$1 WHERE id=$2`,
          [err.message, post.id]
        );
        logger.error(`Failed to publish scheduled post ${post.id}: ${err.message}`);
      }
    }
  });

  logger.info('Post scheduler started (checking every minute)');
}

module.exports = { startScheduler };
