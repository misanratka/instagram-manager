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

const FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';

const POSITIONS = {
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
  const pos  = POSITIONS[overlay.position] || POSITIONS['bot-center'];
  const size = SIZES[overlay.size] || 30;
  const escaped = overlay.text.trim()
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "'")
    .replace(/:/g, '\\:')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');
  const color = overlay.color || 'white';
  let filter = `drawtext=fontfile='${FONT}':text='${escaped}':fontsize=${size}:fontcolor=${color}:borderw=2:bordercolor=black@0.8:x=${pos.x}:y=${pos.y}`;
  if (overlay.startTime > 0 || overlay.endTime > 0) {
    filter += `:enable='between(t,${overlay.startTime || 0},${overlay.endTime || 999})'`;
  }
  return filter;
}

async function enhanceVideo({ inputPath, srtContent, textOverlays = [], burnSubtitles, enhance, trim, adjustments, speed }) {
  const uploadDir = getUploadDir();
  const outFilename = `enhanced_${uuidv4()}.mp4`;
  const outputPath = path.join(uploadDir, outFilename);

  // Build input args with optional trim (input-seeking for speed)
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

  // Speed change
  const spd = Number(speed) || 1;
  if (spd !== 1) {
    vFilters.push(`setpts=${(1 / spd).toFixed(6)}*PTS`);
    aFilters.push(`atempo=${spd}`);
  }

  // Color adjustments (merge user sliders + quality-boost bump)
  const br  = Number(adjustments?.brightness) || 0;
  const ct  = Number(adjustments?.contrast)   || 1;
  const sat = Number(adjustments?.saturation) || 1;
  const finalBr  = enhance ? Math.min(0.5,  br  + 0.05)        : br;
  const finalCt  = enhance ? Math.min(2.0,  ct  * 1.05)        : ct;
  const finalSat = enhance ? Math.min(3.0,  sat * 1.1)         : sat;

  if (Math.abs(finalBr) > 0.001 || Math.abs(finalCt - 1) > 0.001 || Math.abs(finalSat - 1) > 0.001) {
    vFilters.push(`eq=brightness=${finalBr.toFixed(3)}:contrast=${finalCt.toFixed(3)}:saturation=${finalSat.toFixed(3)}`);
  }

  // Sharpening when quality boost is enabled
  if (enhance) {
    vFilters.push('unsharp=3:3:0.8:3:3:0.0');
  }

  // Burn-in subtitles
  let srtPath = null;
  if (burnSubtitles && srtContent) {
    srtPath = writeSRTFile(srtContent, inputPath);
    const escapedSrt = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
    vFilters.push(`subtitles='${escapedSrt}':force_style='FontSize=18,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,Outline=2,Bold=1,Alignment=2'`);
  }

  // Text overlays
  for (const overlay of textOverlays) {
    const f = buildDrawtext(overlay);
    if (f) vFilters.push(f);
  }

  // Lower CRF = higher quality output when boost is on
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
