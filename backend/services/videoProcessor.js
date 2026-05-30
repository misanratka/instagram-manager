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

// Prefer an explicit bold font; fall back to fontconfig name so the OS can
// provide emoji fallback glyphs (Noto Color Emoji etc.) when available.
const FONT_FILE = (() => {
  const candidates = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
    '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
  ];
  return candidates.find(p => fs.existsSync(p)) || null;
})();
const FONT_ATTR = FONT_FILE ? `fontfile='${FONT_FILE}'` : `font='DejaVu Sans Bold'`;

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

function buildCoverBox(overlay) {
  const color = { white: 'white@1.0', light: 'white@0.82', dark: 'black@0.78', black: 'black@1.0' }[overlay.bg] || 'black@0.78';
  let xExpr, yExpr, wExpr, hExpr;

  // Support bgW/bgH from editor (percentages of video dimensions)
  const hasBgSize = (overlay.bgW !== undefined && overlay.bgW !== null) ||
                    (overlay.coverWidthPct !== undefined);
  if (hasBgSize) {
    const xc   = (overlay.xPct / 100).toFixed(6);
    const yc   = (overlay.yPct / 100).toFixed(6);
    const wPct = ((overlay.bgW ?? overlay.coverWidthPct ?? 40) / 100).toFixed(6);
    const hPct = ((overlay.bgH ?? overlay.coverHeightPct ?? 12) / 100).toFixed(6);
    wExpr = `iw*${wPct}`;
    hExpr = `ih*${hPct}`;
    xExpr = `iw*${xc}-(${wExpr})/2`;
    yExpr = `ih*${yc}-(${hExpr})/2`;
  } else {
    const size = overlay.fontSize || SIZES[overlay.size] || 44;
    const numSpaces = Math.max((overlay.text || '').length, 1);
    const boxW = Math.round(numSpaces * size * 0.5) + 20;
    const boxH = Math.round(size * 1.6);
    if (overlay.xPct !== undefined && overlay.yPct !== undefined) {
      const xc = (overlay.xPct / 100).toFixed(6);
      const yc = (overlay.yPct / 100).toFixed(6);
      xExpr = `iw*${xc}-${Math.floor(boxW / 2)}`;
      yExpr = `ih*${yc}-${Math.floor(boxH / 2)}`;
    } else {
      const pos = NAMED_POSITIONS[overlay.position] || NAMED_POSITIONS['bot-center'];
      xExpr = pos.x;
      yExpr = pos.y;
    }
    wExpr = boxW;
    hExpr = boxH;
  }

  let filter = `drawbox=x=${xExpr}:y=${yExpr}:w=${wExpr}:h=${hExpr}:color=${color}:t=fill`;
  if (overlay.startTime > 0 || overlay.endTime > 0) {
    filter += `:enable='between(t,${overlay.startTime || 0},${overlay.endTime || 999})'`;
  }
  return filter;
}

function buildSingleLine(overlay, yOffsetExpr) {
  const size = overlay.fontSize || SIZES[overlay.size] || 44;
  const escaped = overlay.text
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "'")
    .replace(/:/g, '\\:')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]');

  let xExpr, yExpr;
  if (overlay.xPct !== undefined && overlay.yPct !== undefined) {
    const xp = (Number(overlay.xPct) / 100).toFixed(6);
    const yp = (Number(overlay.yPct) / 100).toFixed(6);
    // x: center text at xPct of video width (matches canvas exactly)
    xExpr = `(w*${xp})-(text_w/2)`;
    // y: center text block at yPct of video height + line offset
    const yBase = `(h*${yp})`;
    yExpr = (!yOffsetExpr || yOffsetExpr === 0)
      ? `${yBase}-(text_h/2)`
      : `${yBase}+(${yOffsetExpr})-(text_h/2)`;
  } else {
    const pos = NAMED_POSITIONS[overlay.position] || NAMED_POSITIONS['bot-center'];
    xExpr = pos.x;
    yExpr = (!yOffsetExpr || yOffsetExpr === 0) ? pos.y : `(${pos.y})+(${yOffsetExpr})`;
  }

  let fontcolor, boxPart;
  if (overlay.bg === 'black') {
    fontcolor = 'white';
    boxPart = ':box=1:boxcolor=black:boxborderw=10';
  } else if (overlay.bg === 'white') {
    fontcolor = '#111111';
    boxPart = ':box=1:boxcolor=white:boxborderw=10';
  } else {
    const rawColor = overlay.textColor || overlay.colorHex || overlay.color;
    fontcolor = rawColor ? rawColor.replace('#', '0x') : 'white';
    boxPart = '';
  }

  const fontSizePct = overlay.fontSizePct || (size / 1080);
  let filter = `drawtext=${FONT_ATTR}:text='${escaped}':fontsize=w*${fontSizePct.toFixed(6)}:fontcolor=${fontcolor}${boxPart}:x=${xExpr}:y=${yExpr}`;
  if (overlay.startTime > 0 || overlay.endTime > 0) {
    filter += `:enable='between(t,${overlay.startTime || 0},${overlay.endTime || 999})'`;
  }
  return filter;
}

function buildDrawtext(overlay) {
  // No text (or space-only) + background = solid cover rectangle
  if (overlay.bg !== 'none' && (!overlay.text || overlay.text.trim() === '')) {
    return buildCoverBox(overlay);
  }
  // Never burn empty or placeholder text
  if (!overlay.text || !overlay.text.trim()) return null;
  if (overlay.text.trim() === 'Tap to type') return null;

  const lines = overlay.text.split('\n');
  const fontSizePct = overlay.fontSizePct || 0.074;
  // lineH expressed as fraction of video width (same unit as fontsize=w*fontSizePct)
  // lineH = fontsize * 1.3 = w*fontSizePct*1.3
  const lineHFrac = fontSizePct * 1.3;

  const filters = lines.map((lineText, i) => {
    const text = lineText || (overlay.bg !== 'none' ? ' ' : null);
    if (!text) return null;
    // yOffset as FFmpeg expression in output pixels: (i - center) * w*lineHFrac
    // This matches canvas: startY + i*lineH where lineH=fontSize*1.3
    const offset = i - (lines.length - 1) / 2;
    const yOffsetExpr = offset === 0 ? 0 : `${offset.toFixed(4)}*w*${lineHFrac.toFixed(6)}`;
    return buildSingleLine({ ...overlay, text }, yOffsetExpr);
  }).filter(Boolean);

  return filters.join(',') || null;
}

// Convert SRT segments to word-by-word ASS subtitle string for motion styles
function segmentsToWordASS(segments, style) {
  if (!segments || segments.length === 0) return null;

  // Build approximate word list from segments
  const words = [];
  for (const seg of segments) {
    const raw = seg.text.trim().split(/\s+/).filter(Boolean);
    if (!raw.length) continue;
    const duration = Math.max(0.05, seg.end - seg.start);
    const perWord = duration / raw.length;
    raw.forEach((w, i) => {
      words.push({ word: w, start: seg.start + i * perWord, end: seg.start + (i + 1) * perWord });
    });
  }
  if (!words.length) return null;

  function toT(s) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    const cs = Math.round((s % 1) * 100);
    return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
  }

  const PALETTE = ['&H0000FFFF', '&H0055FF00', '&H00FF00FF', '&H000080FF', '&H00FF8000'];
  const isColor = style === 'word-color';

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,${isColor ? 36 : 32},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,5,10,10,80,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const lines = words.map((w, i) => {
    const colorTag = isColor ? `{\\c${PALETTE[i % PALETTE.length]}}` : '';
    const fadeTag = '{\\fad(80,80)}';
    return `Dialogue: 0,${toT(w.start)},${toT(w.end)},Default,,0,0,0,,${fadeTag}${colorTag}${w.word}`;
  });

  return header + lines.join('\n');
}

function writeSubtitleFile(content, inputPath, ext) {
  const p = inputPath.replace(/\.[^/.]+$/, `.${ext}`);
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

async function enhanceVideo({ inputPath, srtContent, segments, textOverlays = [], burnSubtitles, subtitleStyle = 'standard', enhance, trim, adjustments, speed, cropRatio, qualityPreset, denoise, sharpness, upscale }) {
  const uploadDir = getUploadDir();
  const outFilename = `enhanced_${uuidv4()}.mp4`;
  const outputPath = path.join(uploadDir, outFilename);

  const inputArgs = ['-y', '-threads', '1'];
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

  // 3. Quality preset pipeline
  const PRESETS = {
    instagram: { dL:2,  dC:1,  dT:3,  sL:1.4, sC:0.4,  br:0.06, ct:1.15, sat:1.35, gm:1.04, cas:0.6,  crf:'18', curves:true,  deband:false, nlmeans:false },
    cinematic: { dL:3,  dC:2,  dT:4,  sL:0.8, sC:0.2,  br:0.00, ct:1.25, sat:0.85, gm:1.10, cas:0.4,  crf:'18', curves:true,  deband:false, nlmeans:false },
    crisp:     { dL:1,  dC:1,  dT:2,  sL:2.0, sC:0.6,  br:0.03, ct:1.18, sat:1.10, gm:0.95, cas:0.9,  crf:'17', curves:false, deband:false, nlmeans:false },
    lowlight:  { dL:4,  dC:3,  dT:5,  sL:0.8, sC:0.2,  br:0.15, ct:1.30, sat:1.05, gm:1.40, cas:0.5,  crf:'18', curves:true,  deband:false, nlmeans:false },
    vivid:     { dL:2,  dC:1,  dT:3,  sL:1.2, sC:0.4,  br:0.06, ct:1.18, sat:1.80, gm:0.95, cas:0.7,  crf:'18', curves:true,  deband:false, nlmeans:false },
  };

  const preset = PRESETS[qualityPreset] || (enhance ? PRESETS.instagram : null);

  // NLMeans — removes Instagram compression blocks
  if (preset?.nlmeans) {
    vFilters.push('nlmeans=s=4:p=5:r=11');
  }

  // hqdn3d temporal pass
  const denoiseStrength = Number(denoise) || 0;
  if (preset) {
    // Reduced hqdn3d strength for lower memory usage
    vFilters.push(`hqdn3d=luma_spatial=${Math.min(preset.dL,2)}:chroma_spatial=${Math.min(preset.dC,1)}:luma_tmp=${Math.min(preset.dT,3)}:chroma_tmp=${(Math.min(preset.dT,3) * 0.85).toFixed(1)}`);
  } else if (denoiseStrength > 0) {
    const ls = denoiseStrength, cs = Math.max(0, denoiseStrength - 1), lt = denoiseStrength * 1.5, ct2 = denoiseStrength * 1.1;
    vFilters.push(`hqdn3d=luma_spatial=${ls}:chroma_spatial=${cs}:luma_tmp=${lt}:chroma_tmp=${ct2}`);
  }

  // Upscale with Lanczos
  if (upscale && upscale !== 'none') {
    vFilters.push(`scale=${upscale}:flags=lanczos+accurate_rnd`);
  } else if (preset && textOverlays.length === 0) {
    vFilters.push("scale='if(gt(iw,1920),iw,1920)':'if(gt(ih,1080),ih,1080)':force_original_aspect_ratio=decrease:flags=lanczos");
  }

  // Colour grading
  const br  = Number(adjustments?.brightness) || 0;
  const ct  = Number(adjustments?.contrast)   || 1;
  const sat = Number(adjustments?.saturation) || 1;
  const finalBr  = preset ? Math.min(0.5,  br  + preset.br)  : br;
  const finalCt  = preset ? Math.min(2.5,  ct  * preset.ct)  : ct;
  const finalSat = preset ? Math.min(3.5,  sat * preset.sat) : sat;
  const gammaVal = preset ? preset.gm : 1.0;

  if (Math.abs(finalBr) > 0.001 || Math.abs(finalCt - 1) > 0.001 || Math.abs(finalSat - 1) > 0.001) {
    const gammaStr = (preset && Math.abs(gammaVal - 1) > 0.001) ? `:gamma=${gammaVal}:gamma_weight=0.9` : '';
    vFilters.push(`eq=brightness=${finalBr.toFixed(3)}:contrast=${finalCt.toFixed(3)}:saturation=${finalSat.toFixed(3)}${gammaStr}`);
  }

  // S-curve — per channel RGB, lifted shadows, punchy mids
  if (preset?.curves) {
    vFilters.push("curves=r='0/0 0.1/0.14 0.5/0.56 0.9/0.92 1/1':g='0/0 0.1/0.13 0.5/0.55 0.9/0.91 1/1':b='0/0 0.08/0.10 0.5/0.52 0.9/0.90 1/1'");
  }

  // Deband
  // deband removed - unnecessary on mobile content

  // CAS removed - uses too much memory on free tier

  // Double unsharp — broad structure + fine detail
  if (preset) {
    // Single unsharp pass only — double pass causes OOM on free tier
    const sharpLuma = Number(sharpness) > 0 ? Number(sharpness) : preset.sL;
    vFilters.push(`unsharp=luma_msize_x=3:luma_msize_y=3:luma_amount=${(sharpLuma * 0.8).toFixed(2)}:chroma_msize_x=3:chroma_msize_y=3:chroma_amount=${(preset.sC * 0.4).toFixed(2)}`);
  } else if (Number(sharpness) > 0) {
    const sh = Number(sharpness);
    vFilters.push(`unsharp=luma_msize_x=5:luma_msize_y=5:luma_amount=${sh.toFixed(2)}:chroma_msize_x=3:chroma_msize_y=3:chroma_amount=${(sh * 0.3).toFixed(2)}`);
  }

  // 5. Burn-in subtitles (3 styles)
  let subPath = null;
  if (burnSubtitles && srtContent) {
    if (subtitleStyle === '3d-caps') {
      // Bold 3D all-caps: Impact font, yellow text, heavy shadow
      subPath = writeSRTFile(srtContent, inputPath);
      const esc = subPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
      vFilters.push(`subtitles='${esc}':force_style='FontName=Impact,FontSize=26,PrimaryColour=&H0000FFFF,OutlineColour=&H00000000,ShadowColour=&H80000000,Bold=1,Shadow=4,Outline=2,Alignment=2,MarginV=40,AllCaps=1'`);
    } else if (subtitleStyle === 'word-color' || subtitleStyle === 'word-clean') {
      // Word-by-word motion (approximate timing from segments)
      const assContent = segmentsToWordASS(segments || [], subtitleStyle);
      if (assContent) {
        subPath = writeSubtitleFile(assContent, inputPath, 'ass');
        const esc = subPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
        vFilters.push(`ass='${esc}'`);
      } else {
        // Fallback to standard if no segments
        subPath = writeSRTFile(srtContent, inputPath);
        const esc = subPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
        vFilters.push(`subtitles='${esc}':force_style='FontSize=20,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,Outline=2,Bold=1,Alignment=2'`);
      }
    } else {
      // Standard: white, bold, clean
      subPath = writeSRTFile(srtContent, inputPath);
      const esc = subPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
      vFilters.push(`subtitles='${esc}':force_style='FontSize=20,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,Outline=2,Bold=1,Alignment=2,MarginV=30'`);
    }
  }

  // 6. Text overlays (drag-placed)
  for (const overlay of textOverlays) {
    const f = buildDrawtext(overlay);
    if (f) vFilters.push(f);
  }

  const crf = preset?.crf || (enhance ? '18' : '23');
  const args = [...inputArgs];
  if (vFilters.length > 0) args.push('-vf', vFilters.join(','));
  if (aFilters.length > 0) args.push('-af', aFilters.join(','));

  // Memory-safe encoding for Render free tier (512MB RAM)
  args.push('-c:v', 'libx264');
  args.push('-preset', 'ultrafast');   // Fastest, lowest memory
  args.push('-crf', crf);
  args.push('-threads', '1');          // Single thread = low memory
  args.push('-profile:v', 'baseline'); // Baseline = simplest, least memory
  args.push('-level:v', '3.1');
  args.push('-pix_fmt', 'yuv420p');
  args.push('-maxrate', '4M', '-bufsize', '4M'); // Cap memory buffer
  args.push('-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-movflags', '+faststart', outputPath);

  await runFFmpeg(args, 'enhance');
  if (subPath && fs.existsSync(subPath)) fs.unlinkSync(subPath);

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
