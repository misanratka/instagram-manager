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
    execFile('ffmpeg', args, { timeout: 300000 }, (err, stdout, stderr) => {
      if (err) {
        logger.error(`ffmpeg [${label}] failed: ${err.message}`);
        return reject(new Error(`ffmpeg ${label} failed: ${err.message}`));
      }
      logger.info(`ffmpeg [${label}] complete`);
      resolve();
    });
  });
}

// Write SRT file next to video, return its path
function writeSRTFile(srtContent, videoPath) {
  const srtPath = videoPath.replace(/\.[^/.]+$/, '.srt');
  fs.writeFileSync(srtPath, srtContent, 'utf8');
  return srtPath;
}

// Burn subtitles + add hook text overlay + optional brightness enhancement
async function enhanceVideo({ inputPath, srtContent, hookText, burnSubtitles, addHook, enhance }) {
  const uploadDir = getUploadDir();
  const outFilename = `enhanced_${uuidv4()}.mp4`;
  const outputPath = path.join(uploadDir, outFilename);

  // Build ffmpeg filter chain
  const filters = [];

  // 1. Brightness/contrast enhancement
  if (enhance) {
    filters.push('eq=brightness=0.06:contrast=1.08:saturation=1.1');
  }

  // 2. Subtitle burning
  let srtPath = null;
  if (burnSubtitles && srtContent) {
    srtPath = writeSRTFile(srtContent, inputPath);
    const escapedSrt = srtPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
    filters.push(`subtitles='${escapedSrt}':force_style='FontSize=18,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,Outline=2,Bold=1,Alignment=2'`);
  }

  // 3. Hook text overlay (top, first 3 seconds)
  if (addHook && hookText) {
    const escapedHook = hookText.replace(/'/g, "\\'").replace(/:/g, '\\:');
    filters.push(
      `drawtext=text='${escapedHook}':fontsize=32:fontcolor=white:borderw=3:bordercolor=black:x=(w-text_w)/2:y=60:enable='between(t,0,3)'`
    );
  }

  const args = ['-y', '-i', inputPath];

  if (filters.length > 0) {
    args.push('-vf', filters.join(','));
  }

  args.push(
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '23',
    '-c:a', 'aac',
    '-b:a', '128k',
    '-movflags', '+faststart',
    outputPath
  );

  await runFFmpeg(args, 'enhance');

  // Clean up SRT file
  if (srtPath && fs.existsSync(srtPath)) fs.unlinkSync(srtPath);

  const stats = fs.statSync(outputPath);
  logger.info(`Enhanced video: ${outFilename} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);

  const base = (process.env.PUBLIC_URL || '').replace(/\/$/, '');
  return { path: outputPath, filename: outFilename, url: `${base}/uploads/${outFilename}` };
}

// Extract audio only (for manual transcription fallback)
async function extractAudio(videoPath) {
  const uploadDir = getUploadDir();
  const audioPath = path.join(uploadDir, `audio_${uuidv4()}.mp3`);

  await runFFmpeg([
    '-y', '-i', videoPath,
    '-vn',
    '-c:a', 'libmp3lame',
    '-b:a', '128k',
    audioPath
  ], 'extract-audio');

  return audioPath;
}

// Get video duration in seconds
function getVideoDuration(videoPath) {
  return new Promise((resolve) => {
    execFile('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      videoPath
    ], { timeout: 15000 }, (err, stdout) => {
      if (err) return resolve(0);
      try {
        const info = JSON.parse(stdout);
        resolve(parseFloat(info.format?.duration || 0));
      } catch {
        resolve(0);
      }
    });
  });
}

module.exports = { enhanceVideo, extractAudio, getVideoDuration };
