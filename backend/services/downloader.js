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
  if (fs.existsSync(IG_COOKIES_PATH)) return ['--cookies', IG_COOKIES_PATH];
  if (process.env.COOKIES_FILE) {
    const p = path.resolve(process.env.COOKIES_FILE);
    if (fs.existsSync(p)) { logger.info('Auth: cookies file from COOKIES_FILE'); return ['--cookies', p]; }
    logger.warn(`COOKIES_FILE not found: ${p}`);
  }
  const defaultFile = path.resolve(__dirname, '..', 'cookies.txt');
  if (fs.existsSync(defaultFile)) { logger.info('Auth: backend/cookies.txt'); return ['--cookies', defaultFile]; }
  return [];
}

function hasCookiesConfigured() {
  return fs.existsSync(IG_COOKIES_PATH) ||
    (process.env.COOKIES_FILE && fs.existsSync(path.resolve(process.env.COOKIES_FILE))) ||
    fs.existsSync(path.resolve(__dirname, '..', 'cookies.txt'));
}

function isInstagramUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host === 'instagram.com';
  } catch { return false; }
}

// Try to scrape the video CDN URL from Instagram page HTML
async function scrapeInstagramVideoUrl(url) {
  const axios = require('axios');

  // User agents that sometimes get OG video tags from Instagram
  const userAgents = [
    'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  ];

  for (const ua of userAgents) {
    try {
      const res = await axios.get(url, {
        headers: {
          'User-Agent': ua,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
        },
        timeout: 15000,
        maxRedirects: 5,
      });

      const html = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);

      // og:video:secure_url first (HTTPS mp4)
      const patterns = [
        /<meta[^>]+property="og:video:secure_url"[^>]+content="([^"]+)"/i,
        /<meta[^>]+content="([^"]+)"[^>]+property="og:video:secure_url"/i,
        /<meta[^>]+property="og:video"[^>]+content="([^"]+)"/i,
        /<meta[^>]+content="([^"]+)"[^>]+property="og:video"/i,
      ];
      for (const pat of patterns) {
        const m = html.match(pat);
        if (m && m[1] && (m[1].includes('.mp4') || m[1].includes('video'))) {
          const cdnUrl = m[1].replace(/&amp;/g, '&');
          logger.info(`Found CDN URL via og:video meta (ua: ${ua.substring(0, 20)}...)`);
          return cdnUrl;
        }
      }

      // Embedded JSON: "video_url":"..."
      const videoUrlMatch = html.match(/"video_url"\s*:\s*"([^"]+)"/);
      if (videoUrlMatch) {
        const cdnUrl = videoUrlMatch[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
        logger.info('Found CDN URL via embedded JSON video_url');
        return cdnUrl;
      }
    } catch (e) {
      logger.warn(`Instagram scrape attempt failed (ua: ${ua.substring(0, 20)}...): ${e.message}`);
    }
  }
  return null;
}

// Download a file from a URL using streaming
async function downloadFromUrl(sourceUrl, outputPath) {
  const axios = require('axios');
  const writer = fs.createWriteStream(outputPath);
  const response = await axios({
    method: 'GET',
    url: sourceUrl,
    responseType: 'stream',
    timeout: 300000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
      'Referer': 'https://www.instagram.com/',
    },
  });
  return new Promise((resolve, reject) => {
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

// yt-dlp download wrapped in a promise
function ytDlpDownload(url, outputPath, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const args = [
      url,
      '--output', outputPath,
      '--format', 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[height<=720]/best',
      '--merge-output-format', 'mp4',
      '--no-playlist',
      '--max-filesize', '200m',
      '--quiet',
      '--no-warnings',
      ...extraArgs,
    ];
    execFile('yt-dlp', args, { timeout: 300000 }, (err) => {
      if (err) return reject(new Error(err.message));
      if (!fs.existsSync(outputPath)) return reject(new Error('Download finished but output file not found.'));
      resolve();
    });
  });
}

async function downloadVideo(url) {
  const uploadDir = getUploadDir();
  const filename = `${uuidv4()}.mp4`;
  const outputPath = path.join(uploadDir, filename);
  const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '');

  function result() {
    const stats = fs.statSync(outputPath);
    logger.info(`Downloaded: ${filename} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
    return { path: outputPath, filename, size: stats.size, url: `${base}/uploads/${filename}` };
  }

  if (isInstagramUrl(url)) {
    // 1. Try HTML scraping (no auth needed)
    logger.info('Instagram URL detected — attempting CDN scrape...');
    try {
      const cdnUrl = await scrapeInstagramVideoUrl(url);
      if (cdnUrl) {
        logger.info('Downloading from CDN URL...');
        await downloadFromUrl(cdnUrl, outputPath);
        if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 50000) {
          return result();
        }
        logger.warn('CDN download produced tiny/empty file, trying next method');
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      }
    } catch (e) {
      logger.warn('CDN scrape/download failed:', e.message);
      if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    }

    // 2. Try yt-dlp with cookies
    if (hasCookiesConfigured()) {
      logger.info('Falling back to yt-dlp with cookies...');
      try {
        await ytDlpDownload(url, outputPath, cookieArgs());
        return result();
      } catch (e) {
        logger.error('yt-dlp with cookies failed:', e.message);
        throw new Error('Instagram download failed. Your cookies may have expired — re-export and update INSTAGRAM_COOKIES_CONTENT on Render.');
      }
    }

    // 3. No cookies — yt-dlp last resort (may work for some public posts)
    logger.info('No cookies — trying yt-dlp without auth (may fail for private/logged-in content)...');
    try {
      await ytDlpDownload(url, outputPath, []);
      return result();
    } catch (e) {
      logger.warn('yt-dlp without auth failed:', e.message);
    }

    throw new Error(
      'Instagram download failed. Instagram blocks direct server downloads for Reels.\n\n' +
      'To download this Reel:\n' +
      '1. Open the Reel on your phone → tap ⋮ → Save\n' +
      '2. Then use "Upload Video File" in the app to upload it\n\n' +
      'Or set up Instagram cookies (INSTAGRAM_COOKIES_CONTENT env var on Render).'
    );
  }

  // Non-Instagram: use yt-dlp directly
  logger.info(`Downloading: ${url}`);
  try {
    await ytDlpDownload(url, outputPath, cookieArgs());
    return result();
  } catch (e) {
    logger.error('yt-dlp error:', e.message);
    throw new Error(`Download failed: ${e.message}`);
  }
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
