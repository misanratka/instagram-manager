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

// Returns extra yt-dlp args for authentication.
// Prefers cookies.txt (works with browser open); falls back to --cookies-from-browser (browser must be closed).
function cookieArgs() {
  // 1. Explicit file from env
  if (process.env.COOKIES_FILE) {
    const p = path.resolve(process.env.COOKIES_FILE);
    if (fs.existsSync(p)) { logger.info('Auth: cookies file from COOKIES_FILE'); return ['--cookies', p]; }
    logger.warn(`COOKIES_FILE not found: ${p}`);
  }
  // 2. cookies.txt dropped next to server.js
  const defaultFile = path.resolve(__dirname, '..', 'cookies.txt');
  if (fs.existsSync(defaultFile)) {
    logger.info('Auth: backend/cookies.txt'); return ['--cookies', defaultFile];
  }
  // 3. Browser cookies (only works when that browser is fully closed)
  const browser = process.env.COOKIES_BROWSER || 'chrome';
  logger.info(`Auth: --cookies-from-browser ${browser}`);
  return ['--cookies-from-browser', browser];
}

function downloadVideo(url) {
  return new Promise((resolve, reject) => {
    const uploadDir = getUploadDir();
    const filename = `${uuidv4()}.mp4`;
    const outputPath = path.join(uploadDir, filename);

    const args = [
      url,
      '--output', outputPath,
      '--format', 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
      '--merge-output-format', 'mp4',
      '--no-playlist',
      '--max-filesize', '500m',
      '--quiet',
      '--no-warnings',
      ...cookieArgs()
    ];

    logger.info(`Downloading: ${url}`);

    execFile('yt-dlp', args, { timeout: 300000 }, (err) => {
      if (err) {
        logger.error('yt-dlp error:', err.message);
        return reject(new Error(`Download failed: ${err.message}`));
      }
      if (!fs.existsSync(outputPath)) {
        return reject(new Error('Download finished but output file not found. Try a different URL.'));
      }
      const stats = fs.statSync(outputPath);
      logger.info(`Downloaded: ${filename} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
      resolve({ path: outputPath, filename, size: stats.size, url: `/uploads/${filename}` });
    });
  });
}

function getVideoMetadata(url) {
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
