const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../models/db');
const logger = require('../services/logger');

const router = express.Router();
const GRAPH = 'https://graph.facebook.com/v19.0';

function cfg() {
  return {
    appId:       process.env.FB_APP_ID,
    appSecret:   process.env.FB_APP_SECRET,
    redirectUri: `${(process.env.PUBLIC_URL || '').replace(/\/$/, '')}/auth/callback`,
    frontendUrl: (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '')
  };
}

router.get('/facebook', (req, res) => {
  const { appId, redirectUri } = cfg();
  const scope = 'instagram_basic,instagram_content_publish,pages_show_list,pages_read_engagement,pages_manage_posts';
  const url = `https://www.facebook.com/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&response_type=code`;
  res.redirect(url);
});

router.get('/callback', async (req, res) => {
  const { appId, appSecret, redirectUri, frontendUrl } = cfg();
  const { code, error } = req.query;

  if (error) {
    return res.redirect(`${frontendUrl}?auth_error=${encodeURIComponent(req.query.error_description || error)}`);
  }

  try {
    // Exchange code for short-lived user token
    const tokenRes = await axios.get(`${GRAPH}/oauth/access_token`, {
      params: { client_id: appId, redirect_uri: redirectUri, client_secret: appSecret, code }
    });

    // Exchange for long-lived user token (60-day, page tokens from it never expire)
    const longRes = await axios.get(`${GRAPH}/oauth/access_token`, {
      params: { grant_type: 'fb_exchange_token', client_id: appId, client_secret: appSecret, fb_exchange_token: tokenRes.data.access_token }
    });
    const userToken = longRes.data.access_token;

    // Get pages + linked Instagram accounts
    const pagesRes = await axios.get(`${GRAPH}/me/accounts`, {
      params: { fields: 'id,name,access_token,instagram_business_account', access_token: userToken }
    });

    const pages = pagesRes.data.data || [];
    let added = 0;

    for (const page of pages) {
      if (!page.instagram_business_account) continue;

      const igId  = page.instagram_business_account.id;
      const token = page.access_token; // page token — never expires

      // Try to get IG display name
      let igName = page.name;
      try {
        const igRes = await axios.get(`${GRAPH}/${igId}`, {
          params: { fields: 'id,name', access_token: token }
        });
        igName = igRes.data.name || page.name;
      } catch {}

      const existing = await getDB().get('SELECT id FROM accounts WHERE ig_user_id=$1', [igId]);
      if (existing) {
        await getDB().run('UPDATE accounts SET access_token=$1 WHERE ig_user_id=$2', [token, igId]);
        logger.info(`Updated token for IG account ${igId}`);
      } else {
        await getDB().run(
          `INSERT INTO accounts (id, name, username, ig_user_id, access_token, caption_style) VALUES ($1,$2,$3,$4,$5,$6)`,
          [uuidv4(), page.name, igName, igId, token, 'casual']
        );
        logger.info(`Added IG account ${igId} (${igName})`);
      }
      added++;
    }

    res.redirect(`${frontendUrl}?auth_success=${added}`);
  } catch (err) {
    logger.error('OAuth callback error:', err.message);
    const msg = err.response?.data?.error?.message || err.message;
    res.redirect(`${frontendUrl}?auth_error=${encodeURIComponent(msg)}`);
  }
});

module.exports = router;
