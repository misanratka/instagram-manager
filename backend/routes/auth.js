const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../models/db');
const logger = require('../services/logger');

const router = express.Router();

function cfg() {
  const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');
  return {
    appId:       process.env.IG_APP_ID,
    appSecret:   process.env.IG_APP_SECRET,
    redirectUri: frontendUrl,   // Instagram redirects back to the frontend root
    frontendUrl
  };
}

// Step 1 — send user to Instagram login
router.get('/instagram', (req, res) => {
  const { appId, redirectUri } = cfg();
  const scope = 'instagram_business_basic,instagram_business_content_publish';
  const url = `https://www.instagram.com/oauth/authorize?force_reauth=true&client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}`;
  res.redirect(url);
});

// Step 2 — frontend sends the ?code= here to exchange for a token
router.post('/exchange', async (req, res, next) => {
  const { appId, appSecret, redirectUri, frontendUrl } = cfg();
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'code is required' });

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

    // Get display name
    let igName = 'Instagram Account';
    try {
      const info = await axios.get(`https://graph.instagram.com/v19.0/${igUserId}`, {
        params: { fields: 'id,name,username', access_token: longToken }
      });
      igName = info.data.username || info.data.name || igName;
    } catch {}

    // Save or update
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
    res.json({ success: true, username: igName });
  } catch (err) {
    logger.error('Token exchange failed:', err.message);
    const msg = err.response?.data?.error_message || err.response?.data?.error?.message || err.message;
    res.status(400).json({ error: msg });
  }
});

module.exports = router;
