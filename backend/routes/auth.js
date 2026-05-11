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
    // Exchange code → short-lived token
    // Meta's own curl docs use -F (multipart/form-data), not urlencoded
    logger.info('OAuth step 1: POST to api.instagram.com/oauth/access_token (multipart)');
    const form = new FormData();
    form.append('client_id',     appId);
    form.append('client_secret', appSecret);
    form.append('grant_type',    'authorization_code');
    form.append('redirect_uri',  callbackUrl);
    form.append('code',          code);
    const tokenRes = await axios.post(
      'https://api.instagram.com/oauth/access_token',
      form,
      { headers: form.getHeaders() }
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
    const meRes = await axios.get('https://graph.instagram.com/v22.0/me', {
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
    logger.error('OAuth callback error:', err.message);
    logger.error('OAuth error response data:', JSON.stringify(err.response?.data));
    const rawMsg = err.response?.data?.error_message
      || err.response?.data?.error?.message
      || err.response?.data?.message
      || err.message;
    const detail = err.response?.data ? ` [API: ${JSON.stringify(err.response.data)}]` : '';
    res.redirect(`${frontendUrl}?auth_error=${encodeURIComponent(rawMsg + detail)}`);
  }
});

module.exports = router;
