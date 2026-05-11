const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const logger = require('./logger');

function getUploadDir() {
  return path.resolve(process.env.UPLOAD_DIR || './uploads');
}

function runFFmpeg(args, label) {
  return new Promise((resolve, reject) => {
    logger.info(`ffmpeg [${label}] starting`);
    execFile('ffmpeg', args, { timeout: 300000 }, (err) => {
      if (err) {
        logger.error(`ffmpeg [${label}] failed: ${err.message}`);
        return reject(new Error(`ffmpeg ${label} failed: ${err.message}`));
      }
      logger.info(`ffmpeg [${label}] complete`);
      resolve();
    });
  });
}

function writeSRTFile(srtContent, videoPath) {
  const srtPath = videoPath.replace(/\.[^/.]+$/, '.srt');
  fs.writeFileSync(srtPath, srtContent, 'utf8');
  return srtPath;
}

function getVideoDimensions(videoPath) {
  return new Promise((resolve) => {
    execFile('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_streams', '-select_streams', 'v:0', videoPath], { timeout: 15000 }, (err, stdout) => {
      if (err) return resolve({ width: 1280, height: 720 });
      try {
        const stream = JSON.parse(stdout).streams[0];
        resolve({ width: stream.width || 1280, height: stream.height || 720 });
      } catch { resolve({ width: 1280, height: 720 }); }
    });
  });
}

async function computeCropFilter(inputPath, cropRatio) {
  if (!cropRatio || cropRatio === 'none') return null;
  const parts = cropRatio.split('/').map(Number);
  if (parts.length !== 2 || parts.some(isNaN)) return null;
  const [tw, th] = parts;

  const { width, height } = await getVideoDimensions(inputPath);
  const targetAspect = tw / th;
  const currentAspect = width / height;

  let cropW, cropH, cropX, cropY;
  if (currentAspect > targetAspect) {
    cropH = height;
    cropW = Math.round(height * targetAspect);
    cropW -= cropW % 2;
    cropX = Math.round((width - cropW) / 2);
    cropY = 0;
  } else {
    cropW = width;
    cropH = Math.round(width / targetAspect);
    cropH -= cropH % 2;
    cropX = 0;
    cropY = Math.round((height - cropH) / 2);
  }

  if (cropW === width && cropH === height) return null;
  return `crop=${cropW}:${cropH}:${cropX}:${cropY}`;
}

const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

const NAMED_POSITIONS = {
  'top-left':    { x: '20',            y: '20' },
  'top-center':  { x: '(w-text_w)/2', y: '20' },
  'top-right':   { x: 'w-text_w-20',  y: '20' },
  'mid-left':    { x: '20',            y: '(h-text_h)/2' },
  'mid-center':  { x: '(w-text_w)/2', y: '(h-text_h)/2' },
  'mid-right':   { x: 'w-text_w-20',  y: '(h-text_h)/2' },
  'bot-left':    { x: '20',            y: 'h-text_h-60' },
  'bot-center':  { x: '(w-text_w)/2', y: 'h-text_h-60' },
  'bot-right':   { x: 'w-text_w-20',  y: 'h-text_h-60' },
};

const SIZES = { small: 20, medium: 30, large: 44, xl: 60 };

function buildDrawtext(overlay) {
  if (!overlay.text || !overlay.text.trim()) return null;
  const size = SIZES[overlay.size] || 30;
  const escaped = overlay.text.trim()
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "’")
    .replace(/:/g, '\\:')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
  const color = overlay.color || 'white';

  let xExpr, yExpr;
  if (overlay.xPct !== undefined && overlay.yPct !== undefined) {
    // Percentage coords from the visual drag editor
    const xp = (Number(overlay.xPct) / 100).toFixed(6);
    const yp = (Number(overlay.yPct) / 100).toFixed(6);
    xExpr = `(w*${xp})-(text_w/2)`;
    yExpr = `(h*${yp})-(text_h/2)`;
  } else {
    const pos = NAMED_POSITIONS[overlay.position] || NAMED_POSITIONS['bot-center'];
    xExpr = pos.x;
    yExpr = pos.y;
  }

  let filter = `drawtext=fontfile='${FONT}':text='${escaped}':fontsize=${size}:fontcolor=${color}:borderw=2:bordercolor=black@0.8:x=${xExpr}:y=${yExpr}`;
  if (overlay.startTime > 0 || overlay.endTime > 0) {
    filter += `:enable='between(t,${overlay.startTime || 0},${overlay.endTime || 999})'`;
  }
  return filter;
}

async function enhanceVideo({ inputPath, srtContent, textOverlays = [], burnSubtitles, enhance, trim, adjustments, speed, cropRatio }) {
  const uploadDir = getUploadDir();
  const outFilename = `enhanced_${uuidv4()}.mp4`;
  const outputPath = path.join(uploadDir, outFilename);

  const inputArgs = ['-y'];
  const trimStart = Number(trim?.start) || 0;
  const trimEnd   = Number(trim?.end)   || 0;
  if (trimStart > 0) inputArgs.push('-ss', trimStart.toFixed(3));
  inputArgs.push('-i', inputPath);
  if (trimEnd > trimStart && trimEnd > 0) {
    inputArgs.push('-t', (trimEnd - trimStart).toFixed(3));
  }

  const vFilters = [];
  const aFilters = [];

  // 1. Crop first (changes dimensions)
  const cropFilter = await computeCropFilter(inputPath, cropRatio);
  if (cropFilter) vFilters.push(cropFilter);

  // 2. Speed
  const spd = Number(speed) || 1;
  if (spd !== 1) {
    vFilters.push(`setpts=${(1 / spd).toFixed(6)}*PTS`);
    aFilters.push(`atempo=${spd}`);
  }

  // 3. Color adjustments + quality boost
  const br  = Number(adjustments?.brightness) || 0;
  const ct  = Number(adjustments?.contrast)   || 1;
  const sat = Number(adjustments?.saturation) || 1;
  const finalBr  = enhance ? Math.min(0.5, br  + 0.05) : br;
  const finalCt  = enhance ? Math.min(2.0, ct  * 1.05) : ct;
  const finalSat = enhance ? Math.min(3.0, sat * 1.1)  : sat;

  if (Math.abs(finalBr) > 0.001 || Math.abs(finalCt - 1) > 0.001 || Math.abs(finalSat - 1) > 0.001) {
    vFilters.push(`eq=brightness=${finalBr.toFixed(3)}:contrast=${finalCt.toFixed(3)}:saturation=${finalSat.toFixed(3)}`);
  }

  // 4. Sharpen on quality boost
  if (enhance) vFilters.push('unsharp=3:3:0.8:3:3:0.0');

  // 5. Burn-in subtitles
  let srtPath = null;
  if (burnSubtitles && srtContent) {
    srtPath = writeSRTFile(srtContent, inputPath);
    const escapedSrt = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
    vFilters.push(`subtitles='${escapedSrt}':force_style='FontSize=18,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,Outline=2,Bold=1,Alignment=2'`);
  }

  // 6. Text overlays (drag-placed)
  for (const overlay of textOverlays) {
    const f = buildDrawtext(overlay);
    if (f) vFilters.push(f);
  }

  const crf = enhance ? '20' : '26';
  const args = [...inputArgs];
  if (vFilters.length > 0) args.push('-vf', vFilters.join(','));
  if (aFilters.length > 0) args.push('-af', aFilters.join(','));

  args.push(
    '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '1',
    '-crf', crf, '-c:a', 'aac', '-b:a', '96k',
    '-movflags', '+faststart', outputPath
  );

  await runFFmpeg(args, 'enhance');
  if (srtPath && fs.existsSync(srtPath)) fs.unlinkSync(srtPath);

  const stats = fs.statSync(outputPath);
  logger.info(`Enhanced video: ${outFilename} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
  const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
  return { path: outputPath, filename: outFilename, url: `${base}/uploads/${outFilename}` };
}

async function extractAudio(videoPath) {
  const uploadDir = getUploadDir();
  const audioPath = path.join(uploadDir, `audio_${uuidv4()}.mp3`);
  await new Promise((resolve, reject) => {
    execFile('ffmpeg', ['-y', '-i', videoPath, '-vn', '-c:a', 'libmp3lame', '-b:a', '128k', audioPath], { timeout: 300000 }, (err) => {
      if (err) reject(new Error(`ffmpeg extract-audio failed: ${err.message}`));
      else resolve();
    });
  });
  return audioPath;
}

function getVideoDuration(videoPath) {
  return new Promise((resolve) => {
    execFile('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', videoPath], { timeout: 15000 }, (err, stdout) => {
      if (err) return resolve(0);
      try { resolve(parseFloat(JSON.parse(stdout).format?.duration || 0)); } catch { resolve(0); }
    });
  });
}

module.exports = { enhanceVideo, extractAudio, getVideoDuration };
