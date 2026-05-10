const axios = require('axios');
const logger = require('./logger');

const GRAPH = 'https://graph.facebook.com/v19.0';

async function verifyToken(igUserId, accessToken) {
  try {
    const res = await axios.get(`${GRAPH}/${igUserId}`, {
      params: { fields: 'id,username,name', access_token: accessToken },
      timeout: 15000
    });
    return res.data;
  } catch (err) {
    const meta = err.response?.data?.error;
    throw new Error(meta?.message || 'Instagram verification failed — check your User ID and Access Token');
  }
}

async function createReelContainer(igUserId, accessToken, videoUrl, caption) {
  logger.info(`Creating Reel container for IG user: ${igUserId}`);
  const res = await axios.post(
    `${GRAPH}/${igUserId}/media`,
    null,
    {
      params: {
        media_type: 'REELS',
        video_url: videoUrl,
        caption: caption || '',
        share_to_feed: true,
        access_token: accessToken
      },
      timeout: 30000
    }
  );
  return res.data.id;
}

async function waitForContainer(containerId, accessToken, maxMs = 180000) {
  const step = 5000;
  const limit = Math.ceil(maxMs / step);

  for (let i = 0; i < limit; i++) {
    await new Promise(r => setTimeout(r, step));

    const res = await axios.get(`${GRAPH}/${containerId}`, {
      params: { fields: 'status_code,status', access_token: accessToken },
      timeout: 15000
    });

    const { status_code } = res.data;
    logger.info(`Container ${containerId} status: ${status_code} (${i + 1}/${limit})`);

    if (status_code === 'FINISHED') return;
    if (status_code === 'ERROR' || status_code === 'EXPIRED') {
      throw new Error(`Instagram container processing failed with status: ${status_code}`);
    }
  }

  throw new Error('Timed out waiting for Instagram to process the video container');
}

async function publishContainer(igUserId, accessToken, containerId) {
  logger.info(`Publishing container: ${containerId}`);
  const res = await axios.post(
    `${GRAPH}/${igUserId}/media_publish`,
    null,
    {
      params: { creation_id: containerId, access_token: accessToken },
      timeout: 30000
    }
  );
  return res.data.id;
}

async function postReel(igUserId, accessToken, videoUrl, caption) {
  const containerId = await createReelContainer(igUserId, accessToken, videoUrl, caption);
  await waitForContainer(containerId, accessToken);
  const mediaId = await publishContainer(igUserId, accessToken, containerId);
  logger.info(`Reel published successfully. Media ID: ${mediaId}`);
  return mediaId;
}

module.exports = { postReel, verifyToken };
