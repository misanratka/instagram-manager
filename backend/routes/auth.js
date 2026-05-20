const express  = require('express');
const axios    = require('axios');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../models/db');
const { verifyPublishingAccess, REQUIRED_SCOPES, tokenFingerprint } = require('../services/instagramPoster');
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

router.get('/debug', (req, res) => {
  const { callbackUrl, appId, frontendUrl } = cfg();
  res.json({
    callbackUrl,
    frontendUrl,
    appIdSet:     !!appId,
    appIdPrefix:  appId ? appId.slice(0, 5) + '***' : 'NOT SET',
    appSecretSet: !!process.env.IG_APP_SECRET,
    BACKEND_URL:  process.env.BACKEND_URL  || '(not set - defaulting to localhost:3001)',
    FRONTEND_URL: process.env.FRONTEND_URL || '(not set - defaulting to localhost:5173)',
  });
});

router.get('/debug/accounts', async (req, res, next) => {
  try {
    const rows = await getDB().all(
      `SELECT id, name, username, ig_user_id, access_token, token_scopes, created_at, token_connected_at,
              CASE WHEN access_token IS NOT NULL AND access_token <> '' THEN 1 ELSE 0 END as has_token
       FROM accounts
       ORDER BY token_connected_at DESC, created_at DESC`
    );
    res.json({
      count: rows.length,
      accounts: rows.map(({ access_token, ...row }) => ({
        ...row,
        token_fingerprint: tokenFingerprint(access_token),
      })),
    });
  } catch (err) { next(err); }
});

router.get('/instagram', (req, res) => {
  const { appId, callbackUrl } = cfg();
  const scope = REQUIRED_SCOPES.join(',');
  const url = `https://www.instagram.com/oauth/authorize?force_reauth=true` +
    `&client_id=${encodeURIComponent(appId)}` +
    `&redirect_uri=${encodeURIComponent(callbackUrl)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scope)}`;
  logger.info(`OAuth redirect: callbackUrl=${callbackUrl}`);
  res.redirect(url);
});

router.get('/callback', async (req, res) => {
  const { code, error: igError } = req.query;
  const { appId, appSecret, callbackUrl, frontendUrl } = cfg();

  logger.info(`OAuth callback received: code_present=${!!code} callbackUrl=${callbackUrl}`);

  if (igError || !code) {
    const desc = req.query.error_description || req.query.error_reason || igError || 'No code returned';
    return res.redirect(`${frontendUrl}?auth_error=${encodeURIComponent(desc)}`);
  }

  try {
    logger.info('OAuth step 1: POST api.instagram.com/oauth/access_token (urlencoded)');
    const bodyParams = new URLSearchParams({
      client_id:     appId,
      client_secret: appSecret,
      grant_type:    'authorization_code',
      redirect_uri:  callbackUrl,
      code,
    });

    let shortToken;
    let tokenUserId;
    try {
      const tokenRes = await axios.post(
        'https://api.instagram.com/oauth/access_token',
        bodyParams.toString(),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, maxRedirects: 0 }
      );
      shortToken = tokenRes.data.access_token;
      tokenUserId = tokenRes.data.user_id ? String(tokenRes.data.user_id) : null;
      logger.info('OAuth step 1 OK', {
        userIdPresent: !!tokenUserId,
        oauthReturnedUserId: tokenUserId,
        tokenFingerprint: tokenFingerprint(shortToken),
        responseKeys: Object.keys(tokenRes.data),
      });
    } catch (e) {
      const msg = e.response?.data?.error?.message || e.response?.data?.error_message || e.message;
      logger.error(`OAuth step 1 FAILED status=${e.response?.status}: ${JSON.stringify(e.response?.data)}`);
      throw new Error(`[Step1-token] ${msg} ${e.response?.data ? JSON.stringify(e.response.data) : ''}`);
    }

    if (!tokenUserId) {
      throw new Error('[Step1-token] user_id missing from token response - cannot identify account');
    }

    let longToken;
    try {
      const longRes = await axios.get('https://graph.instagram.com/access_token', {
        params: { grant_type: 'ig_exchange_token', client_secret: appSecret, access_token: shortToken },
        maxRedirects: 0,
      });
      longToken = longRes.data.access_token;
      logger.info('OAuth step 2 OK: got long-lived token', {
        tokenFingerprint: tokenFingerprint(longToken),
      });
    } catch (e) {
      logger.error(`OAuth step 2 FAILED (ig_exchange_token): ${JSON.stringify(e.response?.data)}`);
      throw new Error(`[Step2-long-lived-token] ${e.response?.data?.error?.message || e.response?.data?.error_message || e.message}`);
    }

    const oauthReturnedUserId = tokenUserId;
    let igUserId = oauthReturnedUserId;
    let igName = `ig_${igUserId}`;
    let graphReadResolvedId = null;

    try {
      const meRes = await axios.get(`https://graph.instagram.com/${igUserId}`, {
        params:  { fields: 'id,username' },
        headers: { Authorization: `Bearer ${longToken}` },
        maxRedirects: 0,
      });
      graphReadResolvedId = meRes.data.id ? String(meRes.data.id) : null;
      igName = meRes.data.username || igName;
      logger.info('OAuth step 3 OK', {
        oauthReturnedUserId,
        graphReadResolvedId,
        username: igName,
        tokenFingerprint: tokenFingerprint(longToken),
      });
    } catch (e) {
      logger.warn(`OAuth step 3 username fetch failed: ${JSON.stringify(e.response?.data)} - using placeholder`);
    }

    let capability;
    try {
      capability = await verifyPublishingAccess(igUserId, longToken);
      if (capability.igUserId && String(capability.igUserId) !== String(igUserId)) {
        logger.warn('OAuth account ID adjusted after publishing verification', {
          oauthReturnedUserId,
          graphReadResolvedId,
          verificationResolvedId: capability.igUserId,
        });
        igUserId = String(capability.igUserId);
      }
      igName = capability.username || igName;
      logger.info('OAuth step 4 OK: publishing access verified', {
        igUserId,
        oauthReturnedUserId,
        graphReadResolvedId,
        resolvedMetaAccountId: capability.resolvedAccountId,
        username: capability.username || igName,
        accountType: capability.accountType,
        expiresAt: capability.expiresAt,
        scopes: capability.scopes,
        tokenAppId: capability.tokenAppId,
        tokenProfileId: capability.tokenProfileId,
        tokenType: capability.tokenType,
        supportsPublishingTarget: capability.supportsPublishingTarget,
      });
      if (!longToken || !capability.supportsPublishingTarget) {
        throw new Error('No usable publishing token was produced by the login flow.');
      }
    } catch (e) {
      logger.error(`OAuth step 4 FAILED: ${e.message}`, { igUserId });
      throw new Error(`[Step4-capability-check] ${e.message}`);
    }

    logger.info('OAuth account save decision', {
      oauthReturnedUserId,
      graphReadResolvedId,
      savedIgUserId: igUserId,
      resolvedMetaAccountId: capability?.resolvedAccountId || null,
      username: igName,
      tokenFingerprint: tokenFingerprint(longToken),
      tokenScopes: capability?.scopes || [],
    });

    const existing = await getDB().get('SELECT id FROM accounts WHERE ig_user_id=$1', [igUserId]);
    if (existing) {
      await getDB().run(
        'UPDATE accounts SET access_token=$1, token_scopes=$2, token_connected_at=CURRENT_TIMESTAMP WHERE ig_user_id=$3',
        [longToken, JSON.stringify(capability.scopes || []), igUserId]
      );
      logger.info('OAuth token stored for existing account', {
        igUserId,
        tokenFingerprint: tokenFingerprint(longToken),
        tokenScopes: capability.scopes || [],
      });
    } else {
      await getDB().run(
        `INSERT INTO accounts (id, name, username, ig_user_id, access_token, token_scopes, caption_style, token_connected_at) VALUES ($1,$2,$3,$4,$5,$6,$7,CURRENT_TIMESTAMP)`,
        [uuidv4(), igName, igName, igUserId, longToken, JSON.stringify(capability.scopes || []), 'casual']
      );
      logger.info('OAuth token stored for new account', {
        igUserId,
        tokenFingerprint: tokenFingerprint(longToken),
        tokenScopes: capability.scopes || [],
      });
    }

    const stored = await getDB().get(
      'SELECT id, ig_user_id, access_token, token_scopes, token_connected_at FROM accounts WHERE ig_user_id=$1',
      [igUserId]
    );
    if (!stored?.access_token) {
      throw new Error('[Step5-store-check] Account row was created/updated but no access token was stored.');
    }
    logger.info('OAuth token stored successfully', {
      igUserId,
      storedAccountId: stored.id,
      tokenFingerprint: tokenFingerprint(stored.access_token),
      tokenScopes: stored.token_scopes || null,
      tokenConnectedAt: stored.token_connected_at || null,
    });

    logger.info(`Instagram account connected: @${igName}`);
    res.redirect(`${frontendUrl}?auth_success=${encodeURIComponent(igName)}`);
  } catch (err) {
    logger.error('OAuth error:', err.message);
    res.redirect(`${frontendUrl}?auth_error=${encodeURIComponent(err.message)}`);
  }
});

module.exports = router;
