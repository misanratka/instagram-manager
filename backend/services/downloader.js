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

// Properly extract a balanced JSON object starting at startIdx in str
function extractJson(str, startIdx) {
  let depth = 0;
  for (let i = startIdx; i < str.length; i++) {
    if (str[i] === '{' || str[i] === '[') depth++;
    else if (str[i] === '}' || str[i] === ']') {
      depth--;
      if (depth === 0) return str.slice(startIdx, i + 1);
    }
  }
  return null;
}

function extractVideoUrlFromHtml(html) {
  if (!html || typeof html !== 'string') return null;

  // ── JSON-LD VideoObject (most reliable structured data) ──────────────────────
  const ldBlocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const [, inner] of ldBlocks) {
    try {
      const obj = JSON.parse(inner.trim());
      const items = Array.isArray(obj['@graph']) ? obj['@graph'] : [obj];
      for (const item of items) {
        if (item.contentUrl && item['@type'] === 'VideoObject') return item.contentUrl;
      }
    } catch {}
  }

  // ── window.__additionalDataLoaded (Instagram embed page payload) ──────────────
  // Use balanced-bracket extraction so nested objects don't get truncated
  const addlIdx = html.indexOf('window.__additionalDataLoaded(');
  if (addlIdx !== -1) {
    const objStart = html.indexOf('{', addlIdx);
    if (objStart !== -1) {
      const raw = extractJson(html, objStart);
      if (raw) {
        try {
          const data = JSON.parse(raw);
          const vu = data?.shortcode_media?.video_url;
          if (vu) return vu.replace(/\\u0026/g, '&');
        } catch {}
      }
    }
  }

  // ── Embedded __bbox / require() payloads (newer Instagram format) ─────────────
  const bboxMatches = [...html.matchAll(/"video_url"\s*:\s*"(https:[^"]+)"/g)];
  if (bboxMatches.length > 0) {
    return bboxMatches[0][1].replace(/\\u0026/g, '&').replace(/\\\//g, '/');
  }

  // ── <video> / <source> tags ───────────────────────────────────────────────────
  const vtag = html.match(/<(?:video|source)[^>]+src=["'](https:[^"']+)["']/i);
  if (vtag) return vtag[1].replace(/&amp;/g, '&');

  // ── og:video meta tags ────────────────────────────────────────────────────────
  for (const pat of [
    /<meta[^>]+property="og:video:secure_url"[^>]+content="([^"]+)"/i,
    /<meta[^>]+content="([^"]+)"[^>]+property="og:video:secure_url"/i,
    /<meta[^>]+property="og:video"[^>]+content="([^"]+)"/i,
    /<meta[^>]+content="([^"]+)"[^>]+property="og:video"/i,
  ]) {
    const m = html.match(pat);
    if (m?.[1] && (m[1].includes('.mp4') || m[1].includes('video'))) return m[1].replace(/&amp;/g, '&');
  }

  // ── Any cdninstagram / fbcdn mp4 URL ─────────────────────────────────────────
  const cdn = html.match(/(https:\/\/[^"'\s\\]+(?:cdninstagram|fbcdn)[^"'\s\\]+\.mp4[^"'\s\\]*)/);
  if (cdn) return cdn[1].replace(/\\u0026/g, '&').replace(/\\\//g, '/').replace(/&amp;/g, '&');

  return null;
}

async function scrapeInstagramVideoUrl(url) {
  const axios = require('axios');

  const match = url.match(/(?:reel|p|tv)\/([A-Za-z0-9_-]+)/);
  if (!match) return null;
  const sc = match[1];

  async function tryFetch(targetUrl, headers) {
    const res = await axios.get(targetUrl, {
      headers,
      timeout: 20000,
      maxRedirects: 5,
      decompress: true,
    });
    return extractVideoUrlFromHtml(typeof res.data === 'string' ? res.data : JSON.stringify(res.data));
  }

  // ── Strategy 1: Embed page (/reel/SC/embed/) ─────────────────────────────────
  // Instagram must serve this to all origins for web embeds to work.
  // The page contains the full shortcode_media JSON with video_url.
  const embedHeaders = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': 'https://www.google.com/',
    'sec-fetch-dest': 'iframe',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'cross-site',
  };
  for (const eu of [
    `https://www.instagram.com/reel/${sc}/embed/`,
    `https://www.instagram.com/p/${sc}/embed/`,
    `https://www.instagram.com/reel/${sc}/embed/captioned/`,
  ]) {
    try {
      const found = await tryFetch(eu, embedHeaders);
      if (found) { logger.info(`CDN URL found via embed page`); return found; }
    } catch (e) {
      logger.warn(`Embed page ${eu} failed: ${e.message}`);
    }
  }

  // ── Strategy 2: facebookexternalhit UA ────────────────────────────────────────
  try {
    const found = await tryFetch(url, {
      'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    });
    if (found) { logger.info('CDN URL found via facebookexternalhit'); return found; }
  } catch (e) {
    logger.warn('facebookexternalhit failed:', e.message);
  }

  // ── Strategy 3: Mobile Chrome UA ─────────────────────────────────────────────
  try {
    const found = await tryFetch(url, {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/124.0.6367.82 Mobile/15E148 Safari/604.1',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    });
    if (found) { logger.info('CDN URL found via mobile UA'); return found; }
  } catch (e) {
    logger.warn('Mobile UA failed:', e.message);
  }

  return null;
}

// ── RapidAPI fallback (optional — set RAPIDAPI_KEY in Render env vars) ──────────
// Sign up free at rapidapi.com, subscribe to "Instagram Downloader" (free tier).
// Returns the video CDN URL string or null.
async function downloadViaRapidAPI(url) {
  if (!process.env.RAPIDAPI_KEY) return null;
  const axios = require('axios');
  const hosts = [
    {
      host: 'instagram-downloader-download-instagram-videos-stories1.p.rapidapi.com',
      endpoint: 'https://instagram-downloader-download-instagram-videos-stories1.p.rapidapi.com/get-info-rapidapi',
      paramKey: 'url',
      pick: d => d?.result?.url || d?.url || d?.media_url,
    },
    {
      host: 'social-media-video-downloader.p.rapidapi.com',
      endpoint: 'https://social-media-video-downloader.p.rapidapi.com/smvd/get/instagram',
      paramKey: 'url',
      pick: d => (d?.links?.find?.(l => l.quality === 'hd') || d?.links?.find?.(l => l.quality === 'sd' || l.type === 'mp4'))?.link || d?.link,
    },
  ];

  for (const api of hosts) {
    try {
      logger.info(`Trying RapidAPI host: ${api.host}`);
      const res = await axios.get(api.endpoint, {
        params: { [api.paramKey]: url },
        headers: {
          'X-RapidAPI-Key': process.env.RAPIDAPI_KEY,
          'X-RapidAPI-Host': api.host,
        },
        timeout: 20000,
      });
      const mediaUrl = api.pick(res.data);
      if (mediaUrl) { logger.info('RapidAPI returned a media URL'); return mediaUrl; }
    } catch (e) {
      logger.warn(`RapidAPI ${api.host} failed: ${e.message}`);
    }
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
      '--format', 'bv*[height<=1920][width<=1920]+ba/b[height<=1920][width<=1920]/bv*+ba/b',
      '--format-sort', 'res,fps,vcodec:h264,acodec:aac',
      '--merge-output-format', 'mp4',
      '--no-playlist',
      '--max-filesize', '200m',
      '--quiet',
      '--no-warnings',
      ...extraArgs,
    ];
    execFile('yt-dlp', args, { timeout: 300000 }, (err) => {
      if (err) return reject(new Error(err.message));
      if (!fs.existsSync(outputPath)) return reject(new Error('yt-dlp finished but file not found.'));
      resolve();
    });
  });
}

function probeSize(file) {
  return new Promise((resolve) => {
    execFile('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height',
      '-of', 'csv=p=0:s=x', file], { timeout: 20000 }, (err, stdout) => {
      if (err) return resolve({ w: 0, h: 0 });
      const [w, h] = String(stdout).trim().split('x').map(Number);
      resolve({ w: w || 0, h: h || 0 });
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
    // Try every method and KEEP THE HIGHEST RESOLUTION (the old flow returned the
    // first success, which was usually the low-res page-scrape file).
    const candidates = []; // { name, file, w, h, px }
    const failures = [];   // short reasons, shown to the user if every method fails
    let cookieFailed = false;

    async function tryCandidate(name, fn) {
      const file = path.join(uploadDir, `cand_${name}_${uuidv4()}.mp4`);
      try {
        await fn(file);
        if (fs.existsSync(file) && fs.statSync(file).size > 50000) {
          const { w, h } = await probeSize(file);
          logger.info(`IG candidate [${name}]: ${w}x${h}, ${(fs.statSync(file).size / 1048576).toFixed(1)} MB`);
          candidates.push({ name, file, w, h, px: w * h });
          return w && h && Math.min(w, h) >= 1080; // true = already full HD, stop searching
        }
        try { fs.unlinkSync(file); } catch {}
      } catch (e) {
        logger.warn(`IG candidate [${name}] failed: ${e.message}`);
        failures.push(`${name}: ${String((String(e.message).match(/ERROR:\s*(.+)/) || [])[1] || e.message).split('\n')[0].slice(0, 160)}`);
        if (name === 'ytdlp-cookies') cookieFailed = true;
        try { if (fs.existsSync(file)) fs.unlinkSync(file); } catch {}
      }
      return false;
    }

    let done = false;

    // 1. yt-dlp (+ cookies if configured) — only method that can reach the DASH 1080p streams
    if (hasCookiesConfigured()) {
      done = await tryCandidate('ytdlp-cookies', f => ytDlpDownload(url, f, cookieArgs()));
    }
    if (!done && !candidates.length) {
      done = await tryCandidate('ytdlp', f => ytDlpDownload(url, f, [
        '--add-header', 'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      ]));
    }

    // 2. HTML scrape
    if (!done) {
      done = await tryCandidate('scrape', async f => {
        const cdnUrl = await scrapeInstagramVideoUrl(url);
        if (!cdnUrl) throw new Error('no CDN url');
        await downloadFromUrl(cdnUrl, f);
      });
    }

    // 3. RapidAPI
    if (!done) {
      await tryCandidate('rapidapi', async f => {
        const mediaUrl = await downloadViaRapidAPI(url);
        if (!mediaUrl) throw new Error('no media url');
        await downloadFromUrl(mediaUrl, f);
      });
    }

    if (candidates.length) {
      candidates.sort((x, y) => y.px - x.px);
      const best = candidates[0];
      logger.info(`IG download: using [${best.name}] ${best.w}x${best.h}`);
      for (const c of candidates.slice(1)) { try { fs.unlinkSync(c.file); } catch {} }
      fs.renameSync(best.file, outputPath);
      const res = buildResult();
      res.width = best.w; res.height = best.h;
      return res;
    }

    if (cookieFailed) {
      throw new Error('Instagram download failed. Cookies may have expired — re-export and update INSTAGRAM_COOKIES_CONTENT on Render.\nDetails: ' + failures.join(' | '));
    }
    throw new Error(
      'Instagram blocked this download from the server.\nDetails: ' + failures.join(' | ') + '\n\n' +
      'Quick options:\n' +
      '1. Download the Reel to your phone → tap ⋮ → Download, then use "Upload Video File" here\n' +
      '2. For automatic downloads: add a free RAPIDAPI_KEY in Render settings (see below)'
    );
  }

  // Non-Instagram
  logger.info(`Downloading: ${url}`);
  try {
    await ytDlpDownload(url, outputPath, cookieArgs());
    return buildResult();
  } catch (e) {
    logger.error('yt-dlp error:', e.message); cleanup();
    throw new Error(`Download failed: ${e.message}`);
  }
}

async function getInstagramMetadata(url) {
  const axios = require('axios');

  // 1. Try scraping og:description — contains the full post caption
  try {
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      timeout: 12000,
      maxRedirects: 3,
    });
    const html = typeof res.data === 'string' ? res.data : '';
    if (html) {
      const descMatch =
        html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i) ||
        html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:description"/i);
      const titleMatch =
        html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) ||
        html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:title"/i);
      if (descMatch?.[1]) {
        const description = descMatch[1].replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
        const title = titleMatch?.[1]?.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&') || '';
        logger.info('Got Instagram caption via og:description scrape');
        return { title, description, duration: 0 };
      }
    }
  } catch (e) {
    logger.warn('Instagram caption scrape failed:', e.message);
  }

  // 2. Try yt-dlp --dump-json (no video download, just metadata)
  try {
    const metadata = await new Promise((resolve, reject) => {
      execFile('yt-dlp', ['--dump-json', '--no-download', '--no-playlist', url], { timeout: 25000 }, (err, stdout) => {
        if (err) return reject(err);
        try { resolve(JSON.parse(stdout)); } catch { reject(new Error('parse failed')); }
      });
    });
    logger.info('Got Instagram metadata via yt-dlp --dump-json');
    return {
      title: metadata.title || '',
      description: metadata.description || metadata.title || '',
      duration: metadata.duration || 0,
      uploader: metadata.uploader || '',
    };
  } catch (e) {
    logger.warn('yt-dlp metadata for Instagram failed:', e.message);
  }

  // 3. Fall back to oEmbed (title/author only)
  try {
    const appId     = process.env.IG_APP_ID;
    const appSecret = process.env.IG_APP_SECRET;
    if (appId && appSecret) {
      const res = await axios.get('https://graph.instagram.com/oembed', {
        params: { url, access_token: `${appId}|${appSecret}`, fields: 'thumbnail_url,author_name' },
        timeout: 10000,
      });
      const title = res.data.title || res.data.author_name || '';
      return { title, description: title, duration: 0, uploader: res.data.author_name || '' };
    }
  } catch (e) {
    logger.warn('Instagram oEmbed failed:', e.message);
  }

  return { title: '', description: '', duration: 0 };
}

function getVideoMetadata(url) {
  if (isInstagramUrl(url)) return getInstagramMetadata(url);
  return new Promise((resolve) => {
    const args = ['--dump-json', '--no-download', '--no-playlist', ...cookieArgs(), url];
    execFile('yt-dlp', args, { timeout: 30000 }, (err, stdout) => {
      if (err) return resolve({ title: '', description: '', duration: 0 });
      try {
        const m = JSON.parse(stdout);
        resolve({ title: m.title || '', description: m.description || '', duration: m.duration || 0, uploader: m.uploader || '', thumbnail: m.thumbnail || '' });
      } catch { resolve({ title: '', description: '', duration: 0 }); }
    });
  });
}

function deleteFile(filePath) {
  if (filePath && fs.existsSync(filePath)) { try { fs.unlinkSync(filePath); } catch {} }
}

module.exports = { downloadVideo, getVideoMetadata, deleteFile, getUploadDir };
