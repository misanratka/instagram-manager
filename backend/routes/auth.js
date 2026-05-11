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
    let shortToken, tokenUserId;
    try {
      const tokenRes = await axios.post(
        'https://api.instagram.com/oauth/access_token',
        bodyParams.toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, maxRedirects: 0 }
      );
      shortToken  = tokenRes.data.access_token;
      // Business Login step 1 response always includes user_id
      tokenUserId = tokenRes.data.user_id ? String(tokenRes.data.user_id) : null;
      logger.info(`OAuth step 1 OK: user_id_present=${!!tokenUserId} keys=${Object.keys(tokenRes.data).join(',')}`);
    } catch (e) {
      const msg = e.response?.data?.error?.message || e.response?.data?.error_message || e.message;
      logger.error(`OAuth step 1 FAILED status=${e.response?.status}: ${JSON.stringify(e.response?.data)}`);
      throw new Error(`[Step1-token] ${msg} ${e.response?.data ? JSON.stringify(e.response.data) : ''}`);
    }

    if (!tokenUserId) {
      throw new Error('[Step1-token] user_id missing from token response — cannot identify account');
    }

    // Step 2 — extend to long-lived token (60 days). Best-effort; fall back to short-lived.
    let longToken = shortToken;
    try {
      const longRes = await axios.get('https://graph.instagram.com/access_token', {
        params: { grant_type: 'ig_exchange_token', client_secret: appSecret, access_token: shortToken },
        maxRedirects: 0,
      });
      longToken = longRes.data.access_token;
      logger.info('OAuth step 2 OK: got long-lived token');
    } catch (e) {
      logger.warn(`OAuth step 2 failed (ig_exchange_token): ${JSON.stringify(e.response?.data)} — using short-lived token`);
    }

    // Step 3 — fetch username. The user_id came from step 1 so this is best-effort only;
    // if graph.instagram.com is still rejecting the request, we fall back to a placeholder
    // the user can rename in Account Settings.
    const igUserId = tokenUserId;
    let igName = `ig_${igUserId}`;
    try {
      const meRes = await axios.get(`https://graph.instagram.com/${igUserId}`, {
        params:  { fields: 'id,username' },
        headers: { Authorization: `Bearer ${longToken}` },
        maxRedirects: 0,
      });
      igName = meRes.data.username || igName;
      logger.info(`OAuth step 3 OK: user=${igName} id=${igUserId}`);
    } catch (e) {
      logger.warn(`OAuth step 3 username fetch failed: ${JSON.stringify(e.response?.data)} — using placeholder`);
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
