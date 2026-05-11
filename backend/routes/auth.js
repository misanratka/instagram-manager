const express  = require('express');
const axios    = require('axios');
const FormData = require('form-data');
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

// Debug endpoint — visit /auth/debug to verify env vars are set correctly
router.get('/debug', (req, res) => {
  const { callbackUrl, appId, frontendUrl } = cfg();
  res.json({
    callbackUrl,
    frontendUrl,
    appIdSet:     !!appId,
    appIdPrefix:  appId ? appId.slice(0, 5) + '***' : 'NOT SET',
    appSecretSet: !!process.env.IG_APP_SECRET,
    BACKEND_URL:  process.env.BACKEND_URL  || '(not set — defaulting to localhost:3001)',
    FRONTEND_URL: process.env.FRONTEND_URL || '(not set — defaulting to localhost:5173)',
  });
});

// Step 1 — redirect user to Instagram login
router.get('/instagram', (req, res) => {
  const { appId, callbackUrl } = cfg();
  // Only Standard Access permissions — advanced ones need App Review which we haven't submitted
  const scope = [
    'instagram_business_basic',
    'instagram_business_content_publish',
  ].join(',');
  const url = `https://www.instagram.com/oauth/authorize?force_reauth=true` +
    `&client_id=${encodeURIComponent(appId)}` +
    `&redirect_uri=${encodeURIComponent(callbackUrl)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scope)}`;
  logger.info(`OAuth redirect: callbackUrl=${callbackUrl}`);
  res.redirect(url);
});

// Step 2 — Instagram redirects here with ?code=
router.get('/callback', async (req, res) => {
  const { code, error: igError } = req.query;
  const { appId, appSecret, callbackUrl, frontendUrl } = cfg();

  logger.info(`OAuth callback received: code_present=${!!code} callbackUrl=${callbackUrl}`);

  if (igError || !code) {
    const desc = req.query.error_description || req.query.error_reason || igError || 'No code returned';
    return res.redirect(`${frontendUrl}?auth_error=${encodeURIComponent(desc)}`);
  }

  try {
    // Step 1 — exchange code → short-lived token (URL-encoded body, no redirect following)
    logger.info('OAuth step 1: POST api.instagram.com/oauth/access_token (urlencoded)');
    const bodyParams = new URLSearchParams({
      client_id:     appId,
      client_secret: appSecret,
      grant_type:    'authorization_code',
      redirect_uri:  callbackUrl,
      code,
    });
    let shortToken;
    try {
      const tokenRes = await axios.post(
        'https://api.instagram.com/oauth/access_token',
        bodyParams.toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, maxRedirects: 0 }
      );
      shortToken = tokenRes.data.access_token;
      logger.info('OAuth step 1 OK, got short token');
    } catch (e) {
      const msg = e.response?.data?.error?.message || e.response?.data?.error_message || e.message;
      logger.error(`OAuth step 1 FAILED status=${e.response?.status}: ${JSON.stringify(e.response?.data)}`);
      throw new Error(`[Step1-token] ${msg} ${e.response?.data ? JSON.stringify(e.response.data) : ''}`);
    }

    // Step 2 — exchange short-lived → long-lived token (60 days)
    // Business Login tokens are Facebook User Access Tokens; use fb_exchange_token on graph.facebook.com
    // (ig_exchange_token on graph.instagram.com is for the old Basic Display API)
    logger.info('OAuth step 2: GET graph.facebook.com/oauth/access_token (fb_exchange_token)');
    let longToken = shortToken; // fallback: use short-lived token if exchange fails
    try {
      const longRes = await axios.get('https://graph.facebook.com/oauth/access_token', {
        params: { grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: shortToken },
        maxRedirects: 0,
      });
      longToken = longRes.data.access_token;
      logger.info('OAuth step 2 OK, got long-lived token via fb_exchange_token');
    } catch (e) {
      const msg = e.response?.data?.error?.message || e.response?.data?.error_message || e.message;
      logger.warn(`OAuth step 2 failed (fb_exchange_token): ${msg} — falling back to short-lived token`);
      logger.warn(`Step 2 response: ${JSON.stringify(e.response?.data)}`);
      // Don't throw — continue with the short-lived token; user can reconnect if it expires
    }

    // Step 3 — get user ID and username
    logger.info('OAuth step 3: GET graph.instagram.com/v22.0/me');
    let igUserId, igName;
    try {
      const meRes = await axios.get('https://graph.instagram.com/v22.0/me', {
        params: { fields: 'id,username,name', access_token: longToken },
        maxRedirects: 0,
      });
      igUserId = String(meRes.data.id);
      igName   = meRes.data.username || meRes.data.name || 'Instagram Account';
      logger.info(`OAuth step 3 OK: user=${igName} id=${igUserId}`);
    } catch (e) {
      const msg = e.response?.data?.error?.message || e.response?.data?.error_message || e.message;
      logger.error(`OAuth step 3 FAILED status=${e.response?.status}: ${JSON.stringify(e.response?.data)}`);
      throw new Error(`[Step3-me] ${msg} ${e.response?.data ? JSON.stringify(e.response.data) : ''}`);
    }

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
    logger.error('OAuth error:', err.message);
    res.redirect(`${frontendUrl}?auth_error=${encodeURIComponent(err.message)}`);
  }
});

module.exports = router;
