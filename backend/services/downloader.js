const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const logger = require('./logger');

function getUploadDir() {
  const dir = path.resolve(process.env.UPLOAD_DIR || './uploads');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Write INSTAGRAM_COOKIES_CONTENT env var to a file once at startup
const IG_COOKIES_PATH = path.resolve(__dirname, '..', 'ig_cookies.txt');
(function initCookies() {
  const content = process.env.INSTAGRAM_COOKIES_CONTENT;
  if (content && content.trim()) {
    try {
      fs.writeFileSync(IG_COOKIES_PATH, content.trim(), 'utf8');
      logger.info('Instagram cookies written from INSTAGRAM_COOKIES_CONTENT env var');
    } catch (e) {
      logger.warn('Failed to write Instagram cookies file:', e.message);
    }
  }
})();

function cookieArgs() {
  // 1. Cookies written from INSTAGRAM_COOKIES_CONTENT env var
  if (fs.existsSync(IG_COOKIES_PATH)) {
    return ['--cookies', IG_COOKIES_PATH];
  }
  // 2. Explicit file path from env
  if (process.env.COOKIES_FILE) {
    const p = path.resolve(process.env.COOKIES_FILE);
    if (fs.existsSync(p)) { logger.info('Auth: cookies file from COOKIES_FILE'); return ['--cookies', p]; }
    logger.warn(`COOKIES_FILE not found: ${p}`);
  }
  // 3. cookies.txt dropped next to server.js
  const defaultFile = path.resolve(__dirname, '..', 'cookies.txt');
  if (fs.existsSync(defaultFile)) {
    logger.info('Auth: backend/cookies.txt'); return ['--cookies', defaultFile];
  }
  return [];
}

function isInstagramUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host === 'instagram.com';
  } catch { return false; }
}

function downloadVideo(url) {
  return new Promise((resolve, reject) => {
    const uploadDir = getUploadDir();
    const filename = `${uuidv4()}.mp4`;
    const outputPath = path.join(uploadDir, filename);

    const hasCookies = fs.existsSync(IG_COOKIES_PATH) ||
                       (process.env.COOKIES_FILE && fs.existsSync(path.resolve(process.env.COOKIES_FILE))) ||
                       fs.existsSync(path.resolve(__dirname, '..', 'cookies.txt'));

    if (isInstagramUrl(url) && !hasCookies) {
      return reject(new Error(
        'Instagram cookies not configured. To enable Instagram URL downloads:\n' +
        '1. Install the "Get cookies.txt LOCALLY" extension in Chrome\n' +
        '2. Go to instagram.com while logged in\n' +
        '3. Click the extension and export cookies\n' +
        '4. Copy the file contents\n' +
        '5. Add it as INSTAGRAM_COOKIES_CONTENT environment variable on Render\n\n' +
        'Or download the Reel to your device and use "Upload Video File" instead.'
      ));
    }

    const args = [
      url,
      '--output', outputPath,
      '--format', 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[height<=720]/best',
      '--merge-output-format', 'mp4',
      '--no-playlist',
      '--max-filesize', '200m',
      '--quiet',
      '--no-warnings',
      ...cookieArgs()
    ];

    logger.info(`Downloading: ${url}`);

    execFile('yt-dlp', args, { timeout: 300000 }, (err) => {
      if (err) {
        logger.error('yt-dlp error:', err.message);
        const msg = isInstagramUrl(url)
          ? 'Instagram download failed. Your cookies may have expired — re-export and update INSTAGRAM_COOKIES_CONTENT on Render.'
          : `Download failed: ${err.message}`;
        return reject(new Error(msg));
      }
      if (!fs.existsSync(outputPath)) {
        return reject(new Error('Download finished but output file not found. Try a different URL.'));
      }
      const stats = fs.statSync(outputPath);
      logger.info(`Downloaded: ${filename} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
      const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
      resolve({ path: outputPath, filename, size: stats.size, url: `${base}/uploads/${filename}` });
    });
  });
}

async function getInstagramMetadata(url) {
  try {
    const appId     = process.env.IG_APP_ID;
    const appSecret = process.env.IG_APP_SECRET;
    if (!appId || !appSecret) return { title: '', description: '', duration: 0 };

    const axios = require('axios');
    const res = await axios.get('https://graph.instagram.com/oembed', {
      params: { url, access_token: `${appId}|${appSecret}`, fields: 'thumbnail_url,author_name' },
      timeout: 10000
    });
    const title = res.data.title || res.data.author_name || '';
    logger.info(`Instagram oEmbed fetched for: ${url}`);
    return { title, description: title, duration: 0, uploader: res.data.author_name || '' };
  } catch (err) {
    logger.warn('Instagram oEmbed failed:', err.response?.data?.error?.message || err.message);
    return { title: '', description: '', duration: 0 };
  }
}

function getVideoMetadata(url) {
  if (isInstagramUrl(url)) return getInstagramMetadata(url);

  return new Promise((resolve, reject) => {
    const args = ['--dump-json', '--no-download', '--no-playlist', ...cookieArgs(), url];
    execFile('yt-dlp', args, { timeout: 30000 }, (err, stdout) => {
      if (err) return resolve({ title: '', description: '', duration: 0 });
      try {
        const m = JSON.parse(stdout);
        resolve({
          title: m.title || '',
          description: m.description || '',
          duration: m.duration || 0,
          uploader: m.uploader || '',
          thumbnail: m.thumbnail || ''
        });
      } catch {
        resolve({ title: '', description: '', duration: 0 });
      }
    });
  });
}

function deleteFile(filePath) {
  if (filePath && fs.existsSync(filePath)) {
    try { fs.unlinkSync(filePath); } catch {}
  }
}

module.exports = { downloadVideo, getVideoMetadata, deleteFile, getUploadDir };
