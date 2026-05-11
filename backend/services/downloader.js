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
    if (fs.existsSync(p)) return ['--cookies', p];
  }
  const def = path.resolve(__dirname, '..', 'cookies.txt');
  if (fs.existsSync(def)) return ['--cookies', def];
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

// Pull a video CDN URL out of any HTML blob (embed page, og tags, JSON-LD, etc.)
function extractVideoUrlFromHtml(html) {
  if (!html || typeof html !== 'string') return null;

  // JSON-LD VideoObject — most structured and reliable
  const ldBlocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of ldBlocks) {
    try {
      const inner = block.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '').trim();
      const obj = JSON.parse(inner);
      const items = Array.isArray(obj['@graph']) ? obj['@graph'] : [obj];
      for (const item of items) {
        if (item.contentUrl && item.contentUrl.includes('video')) return item.contentUrl;
      }
    } catch {}
  }

  // window.__additionalDataLoaded payload
  const addl = html.match(/window\.__additionalDataLoaded\([^,]+,\s*(\{[\s\S]*?\})\s*\)/);
  if (addl) {
    try {
      const data = JSON.parse(addl[1]);
      const vu = data?.shortcode_media?.video_url;
      if (vu) return vu.replace(/\\u0026/g, '&');
    } catch {}
  }

  // "video_url":"..."
  const vu = html.match(/"video_url"\s*:\s*"(https:[^"]+)"/);
  if (vu) return vu[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');

  // <video src / <source src
  const vtag = html.match(/<(?:video|source)[^>]+src=["'](https:[^"']+)["']/i);
  if (vtag) return vtag[1].replace(/&amp;/g, '&');

  // og:video meta tags
  for (const pat of [
    /<meta[^>]+property="og:video:secure_url"[^>]+content="([^"]+)"/i,
    /<meta[^>]+content="([^"]+)"[^>]+property="og:video:secure_url"/i,
    /<meta[^>]+property="og:video"[^>]+content="([^"]+)"/i,
    /<meta[^>]+content="([^"]+)"[^>]+property="og:video"/i,
  ]) {
    const m = html.match(pat);
    if (m && m[1] && (m[1].includes('.mp4') || m[1].includes('video'))) {
      return m[1].replace(/&amp;/g, '&');
    }
  }

  // Any cdninstagram / fbcdn URL ending in .mp4
  const cdn = html.match(/(https:\/\/[^"'\s]+(?:cdninstagram|fbcdn)[^"'\s]+\.mp4[^"'\s]*)/);
  if (cdn) return cdn[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/&amp;/g, '&');

  return null;
}

async function scrapeInstagramVideoUrl(url) {
  const axios = require('axios');

  const shortcodeMatch = url.match(/(?:reel|p|tv)\/([A-Za-z0-9_-]+)/);
  if (!shortcodeMatch) return null;
  const sc = shortcodeMatch[1];

  async function tryFetch(targetUrl, headers) {
    const res = await axios.get(targetUrl, {
      headers,
      timeout: 20000,
      maxRedirects: 5,
      decompress: true,
    });
    const html = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
    return extractVideoUrlFromHtml(html);
  }

  // ── Strategy 1: embed page (designed for external iframing) ──────────────────
  // Instagram serves the embed player to any origin; blocking it would break all
  // web embeds. The page contains the full shortcode_media JSON.
  const embedUrls = [
    `https://www.instagram.com/reel/${sc}/embed/`,
    `https://www.instagram.com/p/${sc}/embed/`,
    `https://www.instagram.com/reel/${sc}/embed/captioned/`,
    `https://www.instagram.com/p/${sc}/embed/captioned/`,
  ];
  for (const eu of embedUrls) {
    try {
      logger.info(`Trying embed page: ${eu}`);
      const found = await tryFetch(eu, {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://www.google.com/',
        'sec-fetch-dest': 'iframe',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'cross-site',
        'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
      });
      if (found) { logger.info(`CDN URL found via embed page (${eu})`); return found; }
    } catch (e) {
      logger.warn(`Embed page fetch failed (${eu}): ${e.message}`);
    }
  }

  // ── Strategy 2: facebookexternalhit — Instagram trusts Facebook's crawler ────
  try {
    logger.info('Trying facebookexternalhit UA on main URL');
    const found = await tryFetch(url, {
      'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    });
    if (found) { logger.info('CDN URL found via facebookexternalhit'); return found; }
  } catch (e) {
    logger.warn('facebookexternalhit scrape failed:', e.message);
  }

  // ── Strategy 3: mobile Chrome UA on main URL ─────────────────────────────────
  try {
    logger.info('Trying mobile Chrome UA on main URL');
    const found = await tryFetch(url, {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.82 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    });
    if (found) { logger.info('CDN URL found via mobile Chrome UA'); return found; }
  } catch (e) {
    logger.warn('Mobile UA scrape failed:', e.message);
  }

  return null;
}

async function downloadFromUrl(sourceUrl, outputPath) {
  const axios = require('axios');
  const writer = fs.createWriteStream(outputPath);
  const response = await axios({
    method: 'GET',
    url: sourceUrl,
    responseType: 'stream',
    timeout: 300000,
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15',
      'Referer': 'https://www.instagram.com/',
      'Accept': '*/*',
    },
  });
  return new Promise((resolve, reject) => {
    response.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

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

  function buildResult() {
    const stats = fs.statSync(outputPath);
    logger.info(`Downloaded: ${filename} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
    return { path: outputPath, filename, size: stats.size, url: `${base}/uploads/${filename}` };
  }

  function cleanup() {
    try { if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath); } catch {}
  }

  if (isInstagramUrl(url)) {
    // ── Step 1: HTML scrape (no auth) ────────────────────────────────────────
    try {
      const cdnUrl = await scrapeInstagramVideoUrl(url);
      if (cdnUrl) {
        logger.info('Downloading Instagram video from CDN URL...');
        await downloadFromUrl(cdnUrl, outputPath);
        if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 50000) {
          return buildResult();
        }
        logger.warn('CDN download too small, discarding');
        cleanup();
      }
    } catch (e) {
      logger.warn('CDN scrape/download failed:', e.message);
      cleanup();
    }

    // ── Step 2: yt-dlp with cookies ──────────────────────────────────────────
    if (hasCookiesConfigured()) {
      logger.info('Falling back to yt-dlp with cookies...');
      try {
        await ytDlpDownload(url, outputPath, cookieArgs());
        return buildResult();
      } catch (e) {
        logger.error('yt-dlp + cookies failed:', e.message);
        cleanup();
        throw new Error('Instagram download failed. Cookies may have expired — re-export and update INSTAGRAM_COOKIES_CONTENT on Render.');
      }
    }

    // ── Step 3: yt-dlp without auth (last resort for some public posts) ──────
    logger.info('Trying yt-dlp without auth (may fail)...');
    try {
      await ytDlpDownload(url, outputPath, [
        '--add-header', 'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        '--add-header', 'Accept-Language:en-US,en;q=0.9',
      ]);
      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 50000) {
        return buildResult();
      }
      cleanup();
    } catch (e) {
      logger.warn('yt-dlp without auth failed:', e.message);
      cleanup();
    }

    throw new Error(
      'Instagram blocked this download (server IP restriction).\n\n' +
      'Quick fix — download to your phone first:\n' +
      '1. Open the Reel on Instagram → tap ⋮ → Download\n' +
      '2. Come back here and use the "Upload Video File" button\n\n' +
      'Or enable cookie-based downloads via INSTAGRAM_COOKIES_CONTENT in Render settings.'
    );
  }

  // Non-Instagram URLs — yt-dlp
  logger.info(`Downloading: ${url}`);
  try {
    await ytDlpDownload(url, outputPath, cookieArgs());
    return buildResult();
  } catch (e) {
    logger.error('yt-dlp error:', e.message);
    cleanup();
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
        resolve({ title: m.title || '', description: m.description || '', duration: m.duration || 0, uploader: m.uploader || '', thumbnail: m.thumbnail || '' });
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
