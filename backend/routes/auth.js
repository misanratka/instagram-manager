const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../models/db');
const logger = require('../services/logger');

const router = express.Router();

function cfg() {
  return {
    appId:       process.env.IG_APP_ID,
    appSecret:   process.env.IG_APP_SECRET,
    redirectUri: `${(process.env.PUBLIC_URL || '').replace(/\/$/, '')}/auth/callback`,
    frontendUrl: (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '')
  };
}

// Step 1 — redirect user to Instagram login
router.get('/instagram', (req, res) => {
  const { appId, redirectUri } = cfg();
  const scope = 'instagram_business_basic,instagram_business_content_publish';
  const url = `https://www.instagram.com/oauth/authorize?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&response_type=code`;
  res.redirect(url);
});

// Step 2 — Instagram redirects back here with a code
router.get('/callback', async (req, res) => {
  const { appId, appSecret, redirectUri, frontendUrl } = cfg();
  const { code, error } = req.query;

  if (error) {
    return res.redirect(`${frontendUrl}?auth_error=${encodeURIComponent(req.query.error_description || error)}`);
  }

  try {
    // Exchange code → short-lived token
    const tokenRes = await axios.post(
      'https://api.instagram.com/oauth/access_token',
      new URLSearchParams({ client_id: appId, client_secret: appSecret, grant_type: 'authorization_code', redirect_uri: redirectUri, code }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    const shortToken = tokenRes.data.access_token;
    const igUserId   = String(tokenRes.data.user_id);

    // Exchange → long-lived token (60 days, renewable)
    const longRes = await axios.get('https://graph.instagram.com/access_token', {
      params: { grant_type: 'ig_exchange_token', client_id: appId, client_secret: appSecret, access_token: shortToken }
    });
    const longToken = longRes.data.access_token;

    // Get Instagram username / name
    let igName = 'Instagram Account';
    try {
      const infoRes = await axios.get(`https://graph.instagram.com/v19.0/${igUserId}`, {
        params: { fields: 'id,name,username', access_token: longToken }
      });
      igName = infoRes.data.username || infoRes.data.name || igName;
    } catch {}

    // Save or update in DB
    const existing = await getDB().get('SELECT id FROM accounts WHERE ig_user_id=$1', [igUserId]);
    if (existing) {
      await getDB().run('UPDATE accounts SET access_token=$1 WHERE ig_user_id=$2', [longToken, igUserId]);
      logger.info(`Updated token for @${igName}`);
    } else {
      await getDB().run(
        `INSERT INTO accounts (id, name, username, ig_user_id, access_token, caption_style) VALUES ($1,$2,$3,$4,$5,$6)`,
        [uuidv4(), igName, igName, igUserId, longToken, 'casual']
      );
      logger.info(`Added account @${igName}`);
    }

    res.redirect(`${frontendUrl}?auth_success=1`);
  } catch (err) {
    logger.error('OAuth callback error:', err.message);
    const msg = err.response?.data?.error_message || err.response?.data?.error?.message || err.message;
    res.redirect(`${frontendUrl}?auth_error=${encodeURIComponent(msg)}`);
  }
});

module.exports = router;
