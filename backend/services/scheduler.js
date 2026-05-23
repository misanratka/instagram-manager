const cron = require('node-cron');
const path = require('path');
const axios = require('axios');
const { getDB } = require('../models/db');
const { postReel } = require('./instagramPoster');
const { postReelWithBrowser } = require('./instagramWebPoster');
const logger = require('./logger');

const activePostJobs = new Set();
const activeAccountJobs = new Set();

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
  throw new Error(`Video file missing for post ${post.id} - skipping`);
}

function getLocalVideoPath(post) {
  const fs = require('fs');
  for (const localPath of [post.enhanced_video_path, post.local_video_path]) {
    if (localPath && fs.existsSync(localPath)) return localPath;
  }
  throw new Error(`Local video file missing for post ${post.id} - skipping`);
}

function startScheduler() {
  const selfUrl = `${process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || ''}`.replace(/\/$/, '');

  cron.schedule('* * * * *', async () => {
    let db;
    try { db = getDB(); } catch { return; }

    const now = new Date().toISOString();
    logger.info(`Scheduler tick at ${now}`);

    const duePosts = await db.all(
      `SELECT p.*, a.id as account_ref, a.name as account_name, a.username, a.ig_user_id, a.access_token,
              a.fallback_username, a.fallback_session_path
       FROM posts p JOIN accounts a ON p.account_id = a.id
       WHERE p.status = 'scheduled' AND p.scheduled_at <= $1`,
      [now]
    );

    logger.info(`Scheduler found ${duePosts.length} due post(s)`, { now });

    for (const post of duePosts) {
      const accountKey = post.account_id || post.account_ref || 'no-account';

      if (activePostJobs.has(post.id)) {
        logger.warn(`Skipping post ${post.id} because it is already in flight`, { accountId: accountKey });
        continue;
      }
      if (activeAccountJobs.has(accountKey)) {
        logger.warn(`Skipping post ${post.id} because account is already posting`, { accountId: accountKey });
        continue;
      }

      await db.run(
        `UPDATE posts
         SET status='publishing', error_message=NULL
         WHERE id=$1 AND status='scheduled'`,
        [post.id]
      );

      const locked = await db.get('SELECT status FROM posts WHERE id=$1', [post.id]);
      if (!locked || locked.status !== 'publishing') continue;

      activePostJobs.add(post.id);
      activeAccountJobs.add(accountKey);

      try {
        logger.info(`Scheduler publishing post ${post.id}`, {
          accountId: accountKey,
          accountName: post.account_name || null,
          username: post.username || null,
          igUserId: post.ig_user_id,
        });
        const caption = post.final_caption || post.generated_caption || '';
        const mediaId = post.access_token
          ? await postReel(post.ig_user_id, post.access_token, getVideoPublicUrl(post), caption, {
              postId: post.id,
              accountId: accountKey,
            })
          : (await postReelWithBrowser({
              id: post.account_ref,
              username: post.username,
              fallback_username: post.fallback_username,
              fallback_session_path: post.fallback_session_path,
            }, getLocalVideoPath(post), caption, {
              postId: post.id,
              accountId: accountKey,
            }).then(() => null));
        await db.run(
          `UPDATE posts SET status='posted', posted_at=$1, ig_media_id=$2, error_message=NULL WHERE id=$3`,
          [new Date().toISOString(), mediaId, post.id]
        );
        logger.info(`Scheduled post published: ${post.id} -> ${mediaId}`, {
          accountId: accountKey,
          igUserId: post.ig_user_id,
        });
      } catch (err) {
        await db.run(
          `UPDATE posts SET status='failed', error_message=$1 WHERE id=$2`,
          [err.message, post.id]
        );
        logger.error(`Failed to publish scheduled post ${post.id}: ${err.message}`, {
          accountId: accountKey,
          igUserId: post.ig_user_id,
        });
      } finally {
        activePostJobs.delete(post.id);
        activeAccountJobs.delete(accountKey);
      }
    }
  });

  cron.schedule('*/9 * * * *', async () => {
    if (!selfUrl) return;
    try {
      await axios.get(`${selfUrl}/api/health`, { timeout: 15000 });
      logger.info(`Keep-alive ping OK: ${selfUrl}/api/health`);
    } catch (err) {
      logger.warn(`Keep-alive ping failed: ${err.message}`);
    }
  });

  // Auto-delete posts older than 2 days
  cron.schedule('0 * * * *', async () => {
    let db;
    try { db = getDB(); } catch { return; }
    try {
      const cutoff = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
      const old = await db.all(
        `SELECT id, enhanced_video_path, local_video_path FROM posts WHERE created_at < $1`,
        [cutoff]
      );
      for (const post of old) {
        // Delete video files from disk
        const fs = require('fs');
        for (const p of [post.enhanced_video_path, post.local_video_path]) {
          if (p && fs.existsSync(p)) {
            try { fs.unlinkSync(p); } catch (_) {}
          }
        }
        await db.run('DELETE FROM posts WHERE id=$1', [post.id]);
      }
      if (old.length > 0) logger.info(`Auto-cleaned ${old.length} post(s) older than 2 days`);
    } catch (err) {
      logger.warn(`Auto-cleanup failed: ${err.message}`);
    }
  });

  logger.info('Post scheduler started (checking every minute)');
}

module.exports = { startScheduler };
