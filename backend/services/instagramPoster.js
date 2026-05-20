const axios = require('axios');
const crypto = require('crypto');
const logger = require('./logger');

const READ_GRAPH = 'https://graph.instagram.com/v19.0';
const FB_GRAPH = 'https://graph.facebook.com/v19.0';
const REQUIRED_SCOPES = [
  'instagram_business_basic',
  'instagram_business_content_publish',
];

function getAppAccessToken() {
  const appId = process.env.IG_APP_ID;
  const appSecret = process.env.IG_APP_SECRET;
  if (!appId || !appSecret) return null;
  return `${appId}|${appSecret}`;
}

function tokenFingerprint(accessToken) {
  if (!accessToken) return null;
  return crypto.createHash('sha256').update(accessToken).digest('hex').slice(0, 12);
}

function buildGraphUrl(endpoint, params = {}) {
  const url = new URL(endpoint);
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    url.searchParams.set(key, key === 'access_token' ? 'REDACTED' : String(value));
  });
  return url.toString();
}

function graphErrorDetails(err) {
  return {
    message: err.response?.data?.error?.message || err.response?.data?.error_message || err.message,
    status: err.response?.status || null,
    data: err.response?.data || null,
  };
}

function logGraphError(action, err, meta = {}) {
  const details = graphErrorDetails(err);
  logger.error(`${action} failed`, {
    ...meta,
    status: details.status,
    response: details.data,
    rawGraphError: details.data ? JSON.stringify(details.data) : null,
    errorMessage: details.message,
  });
  return details;
}

async function verifyToken(igUserId, accessToken) {
  const endpoint = `${FB_GRAPH}/${igUserId}`;
  const params = { fields: 'id,name', access_token: accessToken };
  try {
    const res = await axios.get(endpoint, {
      params,
      timeout: 15000
    });
    return { username: res.data.name || igUserId, ...res.data };
  } catch (err) {
    const details = logGraphError('Graph token validation', err, {
      igUserId,
      endpoint,
      requestUrl: buildGraphUrl(endpoint, params),
      tokenFingerprint: tokenFingerprint(accessToken),
    });
    throw new Error(details.message || 'Instagram verification failed - check your User ID and Access Token');
  }
}

async function debugAccessToken(accessToken) {
  const appAccessToken = getAppAccessToken();
  if (!appAccessToken) {
    return {
      isValid: false,
      reason: 'Meta app credentials are missing on the backend. Set IG_APP_ID and IG_APP_SECRET.',
      scopes: [],
      granularScopes: [],
      expiresAt: null,
      dataAccessExpiresAt: null,
      appId: null,
      profileId: null,
      type: null,
      raw: null,
    };
  }

  try {
    const endpoint = `${FB_GRAPH}/debug_token`;
    const params = {
      input_token: accessToken,
      access_token: appAccessToken,
    };
    const res = await axios.get(endpoint, {
      params,
      timeout: 15000,
    });
    const data = res.data?.data || {};
    return {
      isValid: !!data.is_valid,
      reason: data.error?.message || null,
      scopes: Array.isArray(data.scopes) ? data.scopes : [],
      granularScopes: Array.isArray(data.granular_scopes) ? data.granular_scopes : [],
      expiresAt: data.expires_at || null,
      dataAccessExpiresAt: data.data_access_expires_at || null,
      appId: data.app_id || null,
      profileId: data.profile_id || data.user_id || null,
      type: data.type || null,
      raw: data,
    };
  } catch (err) {
    const details = logGraphError('Meta debug_token', err, {
      tokenFingerprint: tokenFingerprint(accessToken),
    });
    return {
      isValid: false,
      reason: details.message || 'Unable to debug the token with Meta.',
      scopes: [],
      granularScopes: [],
      expiresAt: null,
      dataAccessExpiresAt: null,
      appId: null,
      profileId: null,
      type: null,
      raw: null,
    };
  }
}

async function verifyPublishingAccess(igUserId, accessToken) {
  const token = await debugAccessToken(accessToken);
  if (!token.isValid) {
    throw new Error(token.reason || 'Instagram access token is invalid.');
  }

  const missingScopes = REQUIRED_SCOPES.filter(scope => !token.scopes.includes(scope));

  let account;
  const endpoint = `${FB_GRAPH}/${igUserId}`;
  const params = { fields: 'id,username,account_type', access_token: accessToken };
  try {
    const res = await axios.get(endpoint, {
      params,
      timeout: 15000,
    });
    account = res.data || {};
  } catch (err) {
    const details = logGraphError('Instagram professional account verification', err, {
      igUserId,
      endpoint,
      requestUrl: buildGraphUrl(endpoint, params),
      tokenFingerprint: tokenFingerprint(accessToken),
      tokenAppId: token.appId,
      tokenProfileId: token.profileId,
      tokenType: token.type,
      debugToken: token.raw,
    });
    throw new Error(details.message || 'Unable to verify the connected Instagram account.');
  }

  const resolvedAccountId = account.id || null;
  if (resolvedAccountId && String(resolvedAccountId) !== String(igUserId)) {
    throw new Error(`Token/account mismatch: requested Instagram user ${igUserId} but Meta resolved token to ${resolvedAccountId}.`);
  }

  const accountType = account.account_type || null;
  if (accountType && !['BUSINESS', 'MEDIA_CREATOR'].includes(accountType)) {
    throw new Error(`Connected Instagram account type "${accountType}" is not supported for Reel publishing. Use a professional Instagram account.`);
  }

  if (missingScopes.length) {
    throw new Error(`Connected token is missing required Instagram permissions: ${missingScopes.join(', ')}.`);
  }

  return {
    igUserId: resolvedAccountId || igUserId,
    resolvedAccountId,
    accountType,
    username: account.username || null,
    scopes: token.scopes,
    expiresAt: token.expiresAt,
    dataAccessExpiresAt: token.dataAccessExpiresAt,
    tokenFingerprint: tokenFingerprint(accessToken),
    tokenAppId: token.appId,
    tokenProfileId: token.profileId,
    tokenType: token.type,
    supportsPublishingTarget: !!resolvedAccountId && ['BUSINESS', 'MEDIA_CREATOR'].includes(accountType || ''),
    debugToken: token.raw,
  };
}

async function createReelContainer(igUserId, accessToken, videoUrl, caption, context = {}) {
  const endpoint = `${FB_GRAPH}/${igUserId}/media`;
  const params = {
    media_type: 'REELS',
    video_url: videoUrl,
    caption: caption || '',
    share_to_feed: true,
    access_token: accessToken
  };
  logger.info(`Creating Reel container for IG user ${igUserId}`, {
    postId: context.postId || null,
    accountId: context.accountId || null,
    igUserId,
    resolvedMetaAccountId: context.resolvedMetaAccountId || null,
    tokenAppId: context.tokenAppId || null,
    accountType: context.accountType || null,
    endpoint,
    requestUrl: buildGraphUrl(endpoint, params),
    tokenFingerprint: tokenFingerprint(accessToken),
    videoUrl,
  });
  const res = await axios.post(
    endpoint,
    null,
    {
      params,
      timeout: 30000
    }
  );
  logger.info(`Reel container created: ${res.data.id}`, {
    postId: context.postId || null,
    accountId: context.accountId || null,
    igUserId,
    endpoint,
    requestUrl: buildGraphUrl(endpoint, params),
    response: res.data,
  });
  return res.data.id;
}

async function waitForContainer(containerId, accessToken, maxMs = 180000, context = {}) {
  const step = 5000;
  const limit = Math.ceil(maxMs / step);

  for (let i = 0; i < limit; i++) {
    await new Promise(r => setTimeout(r, step));

    let res;
    const endpoint = `${FB_GRAPH}/${containerId}`;
    const params = { fields: 'status_code,status', access_token: accessToken };
    try {
      res = await axios.get(endpoint, {
        params,
        timeout: 15000
      });
    } catch (err) {
      logGraphError('Instagram Reel container status check', err, {
        postId: context.postId || null,
        accountId: context.accountId || null,
        containerId,
        endpoint,
        requestUrl: buildGraphUrl(endpoint, params),
        tokenFingerprint: tokenFingerprint(accessToken),
      });
      throw err;
    }

    const { status_code } = res.data;
    logger.info(`Container ${containerId} status: ${status_code} (${i + 1}/${limit})`, {
      postId: context.postId || null,
      accountId: context.accountId || null,
      endpoint,
      requestUrl: buildGraphUrl(endpoint, params),
      response: res.data,
    });

    if (status_code === 'FINISHED') return;
    if (status_code === 'ERROR' || status_code === 'EXPIRED') {
      throw new Error(`Instagram container processing failed with status: ${status_code}`);
    }
  }

  throw new Error('Timed out waiting for Instagram to process the video container');
}

async function publishContainer(igUserId, accessToken, containerId, context = {}) {
  const endpoint = `${FB_GRAPH}/${igUserId}/media_publish`;
  const params = { creation_id: containerId, access_token: accessToken };
  logger.info(`Publishing container: ${containerId}`, {
    postId: context.postId || null,
    accountId: context.accountId || null,
    igUserId,
    resolvedMetaAccountId: context.resolvedMetaAccountId || null,
    tokenAppId: context.tokenAppId || null,
    accountType: context.accountType || null,
    endpoint,
    requestUrl: buildGraphUrl(endpoint, params),
    tokenFingerprint: tokenFingerprint(accessToken),
  });
  const res = await axios.post(
    endpoint,
    null,
    {
      params,
      timeout: 30000
    }
  );
  logger.info(`Reel publish response for container ${containerId}`, {
    postId: context.postId || null,
    accountId: context.accountId || null,
    igUserId,
    endpoint,
    requestUrl: buildGraphUrl(endpoint, params),
    response: res.data,
  });
  return res.data.id;
}

async function postReel(igUserId, accessToken, videoUrl, caption, context = {}) {
  let containerId;
  try {
    containerId = await createReelContainer(igUserId, accessToken, videoUrl, caption, context);
  } catch (err) {
    logGraphError('Instagram Reel container creation', err, {
      ...context,
      igUserId,
      videoUrl,
      endpoint: `${FB_GRAPH}/${igUserId}/media`,
      requestUrl: buildGraphUrl(`${FB_GRAPH}/${igUserId}/media`, {
        media_type: 'REELS',
        video_url: videoUrl,
        caption: caption || '',
        share_to_feed: true,
        access_token: accessToken
      }),
      tokenFingerprint: tokenFingerprint(accessToken),
    });
    throw err;
  }
  await waitForContainer(containerId, accessToken, 180000, context);
  let mediaId;
  try {
    mediaId = await publishContainer(igUserId, accessToken, containerId, context);
  } catch (err) {
    logGraphError('Instagram Reel publish', err, {
      ...context,
      igUserId,
      containerId,
      endpoint: `${FB_GRAPH}/${igUserId}/media_publish`,
      requestUrl: buildGraphUrl(`${FB_GRAPH}/${igUserId}/media_publish`, {
        creation_id: containerId,
        access_token: accessToken
      }),
      tokenFingerprint: tokenFingerprint(accessToken),
    });
    throw err;
  }
  logger.info(`Reel published successfully. Media ID: ${mediaId}`, {
    postId: context.postId || null,
    accountId: context.accountId || null,
    igUserId,
  });
  return mediaId;
}

module.exports = {
  postReel,
  verifyToken,
  verifyPublishingAccess,
  REQUIRED_SCOPES,
  tokenFingerprint,
  READ_GRAPH,
  FB_GRAPH,
  buildGraphUrl,
};
