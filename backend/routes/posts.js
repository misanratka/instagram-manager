const express = require('express');
const path = require('path');
const { getDB } = require('../models/db');
const { postReel, verifyPublishingAccess, tokenFingerprint } = require('../services/instagramPoster');
const { postReelWithBrowser } = require('../services/instagramWebPoster');
const logger = require('../services/logger');

const router = express.Router();
const activePostPublishes = new Set();

function getVideoPublicUrl(post) {
  const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
  const fs = require('fs');
  for (const localPath of [post.enhanced_video_path, post.local_video_path]) {
    if (localPath && fs.existsSync(localPath)) {
      if (!base) throw new Error('PUBLIC_URL env var is not set.');
      return `${base}/uploads/${path.basename(localPath)}`;
    }
  }
  if (post.video_url && post.video_url.startsWith('http')) return post.video_url;
  throw new Error('Video file not found on server. Please process the video again.');
}

function getLocalVideoPath(post) {
  const fs = require('fs');
  for (const localPath of [post.enhanced_video_path, post.local_video_path]) {
    if (localPath && fs.existsSync(localPath)) return localPath;
  }
  throw new Error('Local video file not found for browser fallback publishing.');
}

// GET posts — filtered by user via their accounts
router.get('/', async (req, res, next) => {
  try {
    const { account_id, status } = req.query;
    const userId = req.headers['x-user-id'];
    let sql = `SELECT p.*, a.name as account_name, a.username
               FROM posts p LEFT JOIN accounts a ON p.account_id = a.id
               WHERE (a.user_id=$1 OR a.user_id IS NULL)`;
    const params = [userId];
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
    const postId = req.params.id;

    if (activePostPublishes.has(postId)) {
      return res.status(409).json({ error: 'This post is already publishing. Please wait a moment and refresh.' });
    }

    if (account_id) await db.run('UPDATE posts SET account_id=$1 WHERE id=$2', [account_id, postId]);
    if (caption !== undefined) await db.run('UPDATE posts SET final_caption=$1 WHERE id=$2', [caption, postId]);
    if (hookText !== undefined) await db.run('UPDATE posts SET hook_text=$1 WHERE id=$2', [hookText, postId]);

    const post = await db.get(
      `SELECT p.*, a.id as account_ref, a.username, a.ig_user_id, a.access_token, a.name as acct_name,
              a.fallback_username, a.fallback_session_path, a.fallback_connected_at
       FROM posts p JOIN accounts a ON p.account_id = a.id
       WHERE p.id=$1`,
      [postId]
    );
    if (!post) return res.status(400).json({ error: 'Post not found, or no account selected for this post' });
    if (post.status === 'publishing') return res.status(409).json({ error: 'This post is already publishing.' });

    if (!post.ig_user_id) {
      return res.status(400).json({ error: `Account "${post.acct_name}" is missing an Instagram User ID.` });
    }
    const usesGraphApi = !!post.access_token;
    if (usesGraphApi) {
      try {
        const capability = await verifyPublishingAccess(post.ig_user_id, post.access_token);
        logger.info(`Token capability check OK for ${post.acct_name}`, {
          accountId: post.account_id || post.account_ref || 'no-account',
          igUserId: post.ig_user_id,
          resolvedMetaAccountId: capability.resolvedAccountId,
          username: capability.username,
          accountType: capability.accountType,
          expiresAt: capability.expiresAt,
          tokenFingerprint: capability.tokenFingerprint,
          tokenAppId: capability.tokenAppId,
          tokenProfileId: capability.tokenProfileId,
          tokenType: capability.tokenType,
          supportsPublishingTarget: capability.supportsPublishingTarget,
        });
        post._publishCapability = capability;
      } catch (err) {
        const msg = err.message || 'Instagram publishing capability check failed.';
        const lower = msg.toLowerCase();
        if (lower.includes('system error') || lower.includes('application info') || lower.includes('unable to debug')) {
          logger.warn(`Meta pre-check returned system error for "${post.acct_name}", proceeding`, { error: msg });
          post._publishCapability = null;
        } else if (lower.includes('invalid') || lower.includes('expired') || lower.includes('access token')) {
          return res.status(400).json({ error: `Token issue for "${post.acct_name}": ${msg}` });
        } else {
          return res.status(400).json({ error: `Cannot publish for "${post.acct_name}": ${msg}` });
        }
      }
    } else if (!post.fallback_session_path) {
      return res.status(400).json({ error: `Account "${post.acct_name}" has no Meta publishing token and no fallback Instagram session.` });
    }

    const videoUrl = usesGraphApi ? getVideoPublicUrl(post) : null;
    const localVideoPath = usesGraphApi ? null : getLocalVideoPath(post);
    const finalCaption = post.final_caption || post.generated_caption || '';
    const accountKey = post.account_id || post.account_ref || 'no-account';
    const tokenPrint = tokenFingerprint(post.access_token);
    const duplicateAccounts = await db.all(
      `SELECT id, name, username, ig_user_id FROM accounts WHERE ig_user_id=$1 AND id <> $2 ORDER BY created_at DESC`,
      [post.ig_user_id, post.account_ref]
    );

    logger.info(`Manual publish requested for post ${post.id}`, {
      accountId: accountKey, accountName: post.acct_name, igUserId: post.ig_user_id,
      publishMethod: usesGraphApi ? 'meta-graph' : 'playwright-fallback',
      tokenFingerprint: tokenPrint, duplicateIgUserRowCount: duplicateAccounts.length,
    });

    await db.run(`UPDATE posts SET status='publishing', error_message=NULL WHERE id=$1`, [post.id]);
    activePostPublishes.add(post.id);
    res.json({ message: 'Publishing to Instagram...', status: 'publishing' });

    const publishPromise = usesGraphApi
      ? postReel(post.ig_user_id, post.access_token, videoUrl, finalCaption, {
          postId: post.id, accountId: accountKey,
          resolvedMetaAccountId: post._publishCapability?.resolvedAccountId || null,
          tokenAppId: post._publishCapability?.tokenAppId || null,
          accountType: post._publishCapability?.accountType || null,
        })
      : postReelWithBrowser({
          id: post.account_ref, username: post.username,
          fallback_username: post.fallback_username,
          fallback_session_path: post.fallback_session_path,
        }, localVideoPath, finalCaption, { postId: post.id, accountId: accountKey }).then(() => null);

    publishPromise
      .then(mediaId => db.run(
        `UPDATE posts SET status='posted', posted_at=$1, ig_media_id=$2, error_message=NULL WHERE id=$3`,
        [new Date().toISOString(), mediaId, post.id]
      ))
      .then(() => logger.info(`Manual publish completed for post ${post.id}`))
      .catch(err => {
        const igErr = err.response?.data?.error;
        let msg = igErr?.message || err.response?.data?.error_message || err.message;
        if (igErr?.code === 190 || msg?.toLowerCase().includes('access token')) {
          msg = `Token issue for "${post.acct_name}": ${msg}. Reconnect the account.`;
        }
        logger.error(`Background publish failed for post ${post.id}: ${msg}`);
        db.run(`UPDATE posts SET status='failed', error_message=$1 WHERE id=$2`, [msg, post.id]).catch(() => {});
      })
      .finally(() => activePostPublishes.delete(post.id));
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    await getDB().run(`UPDATE posts SET status='failed', error_message=$1 WHERE id=$2`, [msg, req.params.id]).catch(() => {});
    res.status(500).json({ error: msg });
  }
});

router.post('/:id/schedule', async (req, res, next) => {
  try {
    const { scheduled_at, account_id, caption } = req.body;
    if (!scheduled_at) return res.status(400).json({ error: 'scheduled_at is required' });
    const db = getDB();
    const postId = req.params.id;
    if (account_id) await db.run('UPDATE posts SET account_id=$1 WHERE id=$2', [account_id, postId]);
    if (caption !== undefined) await db.run('UPDATE posts SET final_caption=$1 WHERE id=$2', [caption, postId]);
    const post = await db.get(
      `SELECT p.*, a.id as account_ref, a.username, a.ig_user_id, a.access_token, a.name as acct_name,
              a.fallback_username, a.fallback_session_path
       FROM posts p JOIN accounts a ON p.account_id = a.id WHERE p.id=$1`,
      [postId]
    );
    if (!post) return res.status(400).json({ error: 'Post not found, or no account selected' });
    if (post.status === 'publishing') return res.status(409).json({ error: 'This post is currently publishing.' });
    if (!post.ig_user_id) return res.status(400).json({ error: `Account "${post.acct_name}" is missing an Instagram User ID.` });
    if (!post.access_token && !post.fallback_session_path) {
      return res.status(400).json({ error: `Account "${post.acct_name}" is missing a token and fallback session.` });
    }
    await db.run(`UPDATE posts SET status='scheduled', scheduled_at=$1, error_message=NULL WHERE id=$2`, [scheduled_at, postId]);
    logger.info(`Post scheduled: ${postId}`, { scheduledAt: scheduled_at });
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
