const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../models/db');
const logger = require('../services/logger');

const router = express.Router();

function cfg() {
  const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
  const backendUrl  = (process.env.BACKEND_URL  || 'http://localhost:3001').replace(/\/$/, '');
  return {
    appId:       process.env.IG_APP_ID,
    appSecret:   process.env.IG_APP_SECRET,
    callbackUrl: `${backendUrl}/auth/callback`,
    frontendUrl
  };
}

// Step 1 — redirect user to Instagram login
// Scope and format taken directly from Meta App Dashboard "Embed URL"
router.get('/instagram', (req, res) => {
  const { appId, callbackUrl } = cfg();
  const scope = [
    'instagram_business_basic',
    'instagram_business_manage_messages',
    'instagram_business_manage_comments',
    'instagram_business_content_publish',
    'instagram_business_manage_insights',
  ].join(',');
  const url = `https://www.instagram.com/oauth/authorize?force_reauth=true` +
    `&client_id=${encodeURIComponent(appId)}` +
    `&redirect_uri=${encodeURIComponent(callbackUrl)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scope)}`;
  res.redirect(url);
});

// Step 2 — Instagram redirects here with ?code=
router.get('/callback', async (req, res) => {
  const { code, error: igError } = req.query;
  const { appId, appSecret, callbackUrl, frontendUrl } = cfg();

  if (igError || !code) {
    const desc = req.query.error_description || req.query.error_reason || igError || 'No code returned';
    return res.redirect(`${frontendUrl}?auth_error=${encodeURIComponent(desc)}`);
  }

  try {
    // Exchange code → short-lived token
    logger.info('OAuth step 1: exchanging code for short token');
    const tokenRes = await axios.post(
      'https://api.instagram.com/oauth/access_token',
      new URLSearchParams({ client_id: appId, client_secret: appSecret, grant_type: 'authorization_code', redirect_uri: callbackUrl, code }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const shortToken = tokenRes.data.access_token;
    logger.info('OAuth step 1 OK, got short token');

    // Exchange → long-lived token (60 days)
    logger.info('OAuth step 2: exchanging for long-lived token');
    const longRes = await axios.get('https://graph.instagram.com/access_token', {
      params: { grant_type: 'ig_exchange_token', client_id: appId, client_secret: appSecret, access_token: shortToken }
    });
    const longToken = longRes.data.access_token;
    logger.info('OAuth step 2 OK, got long token');

    // Get real user ID and username from /me
    logger.info('OAuth step 3: fetching /me');
    const meRes = await axios.get('https://graph.instagram.com/v19.0/me', {
      params: { fields: 'id,username,name', access_token: longToken }
    });
    const igUserId = String(meRes.data.id);
    const igName   = meRes.data.username || meRes.data.name || 'Instagram Account';
    logger.info(`OAuth step 3 OK: user=${igName} id=${igUserId}`);

    // Save or update account
    const existing = await getDB().get('SELECT id FROM accounts WHERE ig_user_id=$1', [igUserId]);
    if (existing) {
      await getDB().run('UPDATE accounts SET access_token=$1 WHERE ig_user_id=$2', [longToken, igUserId]);
    } else {
      await getDB().run(
        `INSERT INTO accounts (id, name, username, ig_user_id, access_token, caption_style) VALUES ($1,$2,$3,$4,$5,$6)`,
        [uuidv4(), igName, igName, igUserId, longToken, 'casual']
      );
    }

    logger.info(`Instagram account connected: @${igName}`);
    res.redirect(`${frontendUrl}?auth_success=${encodeURIComponent(igName)}`);
  } catch (err) {
    logger.error('OAuth callback failed at step:', err.message);
    logger.error('OAuth error response:', JSON.stringify(err.response?.data));
    const msg = err.response?.data?.error_message || err.response?.data?.error?.message || err.message;
    const friendlyMsg = (msg.toLowerCase().includes('method type') || msg.toLowerCase().includes('unsupported request'))
      ? 'Instagram rejected the login. Your Meta app is likely in Development mode — go to Meta App Dashboard → App Roles → Test Users and add the second Instagram account as a Test User. Or switch the app to Live mode.'
      : msg;
    res.redirect(`${frontendUrl}?auth_error=${encodeURIComponent(friendlyMsg)}`);
  }
});

module.exports = router;
