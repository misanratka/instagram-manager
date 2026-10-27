const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const logger = require('./logger');
const { computeLayout } = require('./brandCard');

const THREADS = String(process.env.FFMPEG_THREADS || '1');

function getUploadDir() {
  return path.resolve(process.env.UPLOAD_DIR || './uploads');
}

// Run heavy ffmpeg work at low CPU priority (when `nice` exists) so the web app stays responsive while rendering.
const NICE = fs.existsSync('/usr/bin/nice') ? '/usr/bin/nice' : null;
const FFMPEG_TIMEOUT_MS = Number(process.env.FFMPEG_TIMEOUT_MS) || 15 * 60 * 1000;   // slow CPUs need more than 5 minutes

function runFFmpeg(args, label) {
  return new Promise((resolve, reject) => {
    logger.info(`ffmpeg [${label}] starting`);
    const [cmd, cmdArgs] = NICE ? [NICE, ['-n', '10', 'ffmpeg', ...args]] : ['ffmpeg', args];
    execFile(cmd, cmdArgs, { timeout: FFMPEG_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }, (err) => {
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

// Turns the frame editor's fractions (left/right/top/bottom of the original frame + zoom) into ffmpeg crop filters.
function frameCrop(W, H, fr) {
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const even = (n) => Math.max(2, Math.floor(n / 2) * 2);
  const left = clamp(Number(fr.left) || 0, 0, 0.9);
  const right = clamp(fr.right === undefined ? 1 : Number(fr.right), left + 0.05, 1);
  const top = clamp(Number(fr.top) || 0, 0, 0.9);
  const bottom = clamp(fr.bottom === undefined ? 1 : Number(fr.bottom), top + 0.05, 1);
  const cw = even((right - left) * W), ch = even((bottom - top) * H);
  let cx = Math.min(Math.round(left * W), W - cw), cy = Math.min(Math.round(top * H), H - ch);
  cx = Math.max(0, cx - (cx % 2)); cy = Math.max(0, cy - (cy % 2));   // even offsets keep chroma aligned
  const filters = [];
  if (cw !== W || ch !== H) filters.push(`crop=${cw}:${ch}:${cx}:${cy}`);
  let w = cw, h = ch;
  const z = clamp(Number(fr.zoom) || 1, 1, 3);
  if (z > 1.001) { w = even(cw / z); h = even(ch / z); filters.push(`crop=${w}:${h}`); }   // centred zoom
  return { filters, w, h };
}

// Finds the real picture inside black bars (letterbox/pillarbox). Returns fractions of the frame, or null.
async function detectBarsRect(videoPath) {
  const dims = await getVideoDimensions(videoPath);
  const stderr = await new Promise((resolve) => {
    const cmdArgs = ['-hide_banner', '-ss', '0.3', '-t', '3', '-i', videoPath, '-vf', 'fps=2,scale=trunc(iw/4)*2:trunc(ih/4)*2,cropdetect=limit=24:round=2:reset=0', '-an', '-f', 'null', '-'];
    const [cmd, a] = NICE ? [NICE, ['-n', '10', 'ffmpeg', ...cmdArgs]] : ['ffmpeg', cmdArgs];
    execFile(cmd, a, { timeout: 30000, maxBuffer: 8 * 1024 * 1024 }, (err, so, se) => resolve(String(se || '')));
  });
  const all = [...stderr.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)];
  if (!all.length) return null;
  const [w, h, x, y] = all[all.length - 1].slice(1).map(Number);
  const W = Math.trunc(dims.width / 4) * 2, H = Math.trunc(dims.height / 4) * 2;   // detection ran on a quarter-size picture; fractions stay valid
  if (!w || !h || w < 0.2 * W || h < 0.08 * H || w * h < 0.06 * W * H) return null;   // implausibly small (very dark video) — ignore
  if (w >= W * 0.98 && h >= H * 0.98) return null;                  // no bars
  // tiny trims are noise: snap to the full frame
  const full = (v, total) => v >= 0.97 * total;
  const nx = full(w, W) ? 0 : x, nw = full(w, W) ? W : w;
  const ny = full(h, H) ? 0 : y, nh = full(h, H) ? H : h;
  return { x: nx / W, y: ny / H, w: nw / W, h: nh / H };
}

// Up to `count` small JPEG frames spread through the video. Only key frames are decoded, so this is quick even on a slow CPU.
async function extractFrames(videoPath, count = 6) {
  const dir = fs.mkdtempSync(path.join(getUploadDir(), 'frames_'));
  try {
    const args = ['-hide_banner', '-loglevel', 'error', '-skip_frame', 'nokey', '-i', videoPath,
      '-vf', "select='isnan(prev_selected_t)+gte(t-prev_selected_t,2.5)',scale=640:-2", '-vsync', 'vfr', '-frames:v', String(count), '-q:v', '5', path.join(dir, 'f_%02d.jpg')];
    const [cmd, a] = NICE ? [NICE, ['-n', '10', 'ffmpeg', ...args]] : ['ffmpeg', args];
    await new Promise((resolve, reject) => execFile(cmd, a, { timeout: 60000 }, (err) => (err ? reject(err) : resolve())));
    return fs.readdirSync(dir).filter(f => f.endsWith('.jpg')).sort().map(f => fs.readFileSync(path.join(dir, f)).toString('base64'));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

// ── Find the real video inside a "template" reel ─────────────────────────────────────────────
// Many clips are a video in the middle of a black or white screen with static text above/below.
// Static things (background, text, avatars) never change between frames; the real video does.
// So: look at a few small frames, find where pixels change, and take that block.
const GRID_W = 270;   // analysis width (4 px per cell on a 1080 px frame)

function grabGrayFrames(videoPath, args, w, h) {
  return new Promise((resolve) => {
    const full = ['-hide_banner', '-loglevel', 'error', ...args, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'];
    const [cmd, a] = NICE ? [NICE, ['-n', '10', 'ffmpeg', ...full]] : ['ffmpeg', full];
    execFile(cmd, a, { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 60000 }, (err, stdout) => {
      if (err || !stdout || !stdout.length) return resolve([]);
      const size = w * h, n = Math.floor(stdout.length / size), frames = [];
      for (let i = 0; i < n; i++) frames.push(stdout.subarray(i * size, (i + 1) * size));
      resolve(frames);
    });
  });
}

// Largest run of "on" entries, allowing small gaps. `weight[i]` decides which run wins.
function bestRun(on, weight, maxGap) {
  let best = null, start = -1, last = -1, sum = 0;
  const close = () => { if (start >= 0 && (!best || sum > best.sum)) best = { start, end: last, sum }; };
  for (let i = 0; i < on.length; i++) {
    if (!on[i]) continue;
    if (start >= 0 && i - last - 1 <= maxGap) { last = i; sum += weight[i]; }
    else { close(); start = i; last = i; sum = weight[i]; }
  }
  close();
  return best;
}

function dynamicBox(frames, w, h) {
  const n = frames.length, px = w * h;
  const mean = new Float32Array(px), dev = new Float32Array(px);
  for (const f of frames) for (let i = 0; i < px; i++) mean[i] += f[i];
  for (let i = 0; i < px; i++) mean[i] /= n;
  for (const f of frames) for (let i = 0; i < px; i++) dev[i] += Math.abs(f[i] - mean[i]);
  const T = 4 * n;                                   // average change of ~4 grey levels = "moving"
  const rowCnt = new Float32Array(h);
  for (let y = 0; y < h; y++) { let c = 0; for (let x = 0; x < w; x++) if (dev[y * w + x] > T) c++; rowCnt[y] = c; }
  const rowOn = Array.from(rowCnt, c => c >= 0.10 * w);
  const rows = bestRun(rowOn, rowCnt, 3);
  if (!rows) return null;
  const bandH = rows.end - rows.start + 1;
  const colCnt = new Float32Array(w);
  for (let x = 0; x < w; x++) { let c = 0; for (let y = rows.start; y <= rows.end; y++) if (dev[y * w + x] > T) c++; colCnt[x] = c; }
  const cols = bestRun(Array.from(colCnt, c => c >= 0.15 * bandH), colCnt, 3);
  if (!cols) return null;
  return { x0: cols.start, x1: cols.end, y0: rows.start, y1: rows.end };
}

async function detectMainVideoRect(videoPath) {
  const dims = await getVideoDimensions(videoPath);
  const w = GRID_W, h = Math.max(2, Math.round((w * dims.height) / dims.width / 2) * 2);
  const scale = `scale=${w}:-2`;
  // 1) key frames only (cheap to decode, and a second or more apart so real video differs between them)
  let frames = await grabGrayFrames(videoPath, ['-skip_frame', 'nokey', '-i', videoPath, '-vf', `select='isnan(prev_selected_t)+gte(t-prev_selected_t,1)',${scale}`, '-vsync', 'vfr', '-frames:v', '8'], w, h);
  // 2) too few key frames (short clip): decode a couple of seconds instead
  if (frames.length < 3) frames = await grabGrayFrames(videoPath, ['-ss', '0.3', '-t', '2.5', '-i', videoPath, '-vf', `fps=2,${scale}`, '-frames:v', '5'], w, h);
  if (frames.length < 2) return null;
  const box = dynamicBox(frames, w, h);
  if (!box) return null;
  const bw = box.x1 - box.x0 + 1, bh = box.y1 - box.y0 + 1;
  if (bw < 0.2 * w || bh < 0.08 * h || bw * bh < 0.06 * w * h) return null;   // implausibly small
  if (bw >= 0.97 * w && bh >= 0.97 * h) return null;                           // already the whole frame
  const full = (v, total) => v >= 0.97 * total;
  return {
    x: full(bw, w) ? 0 : box.x0 / w, w: full(bw, w) ? 1 : bw / w,
    y: full(bh, h) ? 0 : box.y0 / h, h: full(bh, h) ? 1 : bh / h
  };
}

// Best guess at the real video: moving block first, plain black-bar trimming as a fallback.
async function detectContentRect(videoPath) {
  try {
    const r = await detectMainVideoRect(videoPath);
    if (r) return r;
  } catch (e) { logger.warn('Motion-based crop detection failed: ' + e.message); }
  return detectBarsRect(videoPath);
}

function getVideoDimensions(videoPath) {
  return new Promise((resolve) => {
    execFile('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_streams', '-select_streams', 'v:0', videoPath], { timeout: 15000 }, (err, stdout) => {
      if (err) return resolve({ width: 1280, height: 720 });
      try {
        const stream = JSON.parse(stdout).streams[0];
        let w = stream.width || 1280, h = stream.height || 720;
        const rotRaw = stream.tags?.rotate ?? (stream.side_data_list || []).find(d => d.rotation !== undefined)?.rotation ?? 0;
        if (Math.abs(Number(rotRaw)) % 180 === 90) [w, h] = [h, w];   // ffmpeg auto-rotates, so use the displayed size
        resolve({ width: w, height: h });
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
  const color = { white: 'white@1.0', light: 'white@0.82', dark: 'black@0.78', black: 'black@1.0', yellow: 'yellow@1.0' }[overlay.bg] || 'black@0.78';

  // Use exact pixel dimensions from the browser canvas (passed as vidW/vidH)
  const refW = overlay.vidW || null;
  const refH = overlay.vidH || null;

  let xExpr, yExpr, wExpr, hExpr;

  const hasBgSize = (overlay.bgW !== undefined && overlay.bgW !== null) ||
                    (overlay.coverWidthPct !== undefined);
  if (hasBgSize) {
    const bgWpct = overlay.bgW ?? overlay.coverWidthPct ?? 40;
    const bgHpct = overlay.bgH ?? overlay.coverHeightPct ?? 12;

    if (refW && refH) {
      // Absolute pixel values — exact 1:1 match with canvas
      const bw = Math.round(bgWpct / 100 * refW);
      const bh = Math.round(bgHpct / 100 * refH);
      const bx = Math.round(overlay.xPct / 100 * refW - bw / 2);
      const by = Math.round(overlay.yPct / 100 * refH - bh / 2);
      wExpr = bw; hExpr = bh; xExpr = bx; yExpr = by;
    } else {
      const xc   = (overlay.xPct / 100).toFixed(6);
      const yc   = (overlay.yPct / 100).toFixed(6);
      const wPct = (bgWpct / 100).toFixed(6);
      const hPct = (bgHpct / 100).toFixed(6);
      wExpr = `iw*${wPct}`;
      hExpr = `ih*${hPct}`;
      xExpr = `iw*${xc}-(${wExpr})/2`;
      yExpr = `ih*${yc}-(${hExpr})/2`;
    }
  } else {
    const size = overlay.fontSize || SIZES[overlay.size] || 44;
    const numSpaces = Math.max((overlay.text || '').length, 1);
    const boxW = Math.round(numSpaces * size * 0.5) + 20;
    const boxH = Math.round(size * 1.6);
    if (refW && refH) {
      xExpr = Math.round(overlay.xPct / 100 * refW - boxW / 2);
      yExpr = Math.round(overlay.yPct / 100 * refH - boxH / 2);
    } else if (overlay.xPct !== undefined && overlay.yPct !== undefined) {
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

  // Use exact pixel dimensions from the browser canvas (passed as vidW/vidH)
  const refW = overlay.vidW || null;
  const refH = overlay.vidH || null;
  const fontSizePct = overlay.fontSizePct || (size / 1080);

  let xExpr, yExpr;
  if (overlay.xPct !== undefined && overlay.yPct !== undefined) {
    if (refW && refH) {
      // Absolute pixel positions — exact 1:1 match with canvas preview
      const px = Math.round(overlay.xPct / 100 * refW);
      const py = Math.round(overlay.yPct / 100 * refH);
      xExpr = `${px}-(text_w/2)`;
      if (!yOffsetExpr || yOffsetExpr === 0) {
        yExpr = `${py}-(text_h/2)`;
      } else {
        // yOffsetExpr is like "0.5*w*0.096" — evaluate using refW
        const offsetPx = Math.round(eval(yOffsetExpr.replace(/w/g, refW)));
        yExpr = `${py + offsetPx}-(text_h/2)`;
      }
    } else {
      const xp = (Number(overlay.xPct) / 100).toFixed(6);
      const yp = (Number(overlay.yPct) / 100).toFixed(6);
      xExpr = `(w*${xp})-(text_w/2)`;
      const yBase = `(h*${yp})`;
      yExpr = (!yOffsetExpr || yOffsetExpr === 0)
        ? `${yBase}-(text_h/2)`
        : `${yBase}+(${yOffsetExpr})-(text_h/2)`;
    }
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

  // Use absolute font size in px if refW available — matches canvas exactly
  const fontSizeExpr = refW
    ? Math.round(fontSizePct * refW)
    : `w*${fontSizePct.toFixed(6)}`;

  let filter = `drawtext=${FONT_ATTR}:text='${escaped}':fontsize=${fontSizeExpr}:fontcolor=${fontcolor}${boxPart}:x=${xExpr}:y=${yExpr}`;
  if (overlay.startTime > 0 || overlay.endTime > 0) {
    filter += `:enable='between(t,${overlay.startTime || 0},${overlay.endTime || 999})'`;
  }
  return filter;
}

function buildDrawtext(overlay) {
  if (overlay.bg !== 'none' && (!overlay.text || overlay.text.trim() === '')) {
    return buildCoverBox(overlay);
  }
  if (!overlay.text || !overlay.text.trim()) return null;
  if (overlay.text.trim() === 'Tap to type') return null;

  const filters = [];

  // If user set bgW/bgH (sized cover box from editor), draw the cover rectangle
  // separately FIRST. Then draw text on top with no inline box so the rectangle
  // matches the editor preview exactly.
  const hasUserSizedCover = overlay.bg !== 'none' &&
    ((overlay.bgW !== undefined && overlay.bgW !== null) ||
     (overlay.bgH !== undefined && overlay.bgH !== null) ||
     overlay.coverWidthPct !== undefined);

  if (hasUserSizedCover) {
    filters.push(buildCoverBox(overlay));
  }

  const lines = overlay.text.split('\n');
  const fontSizePct = overlay.fontSizePct || 0.074;
  const lineHFrac = fontSizePct * 1.3;

  lines.forEach((lineText, i) => {
    const text = lineText || (overlay.bg !== 'none' ? ' ' : null);
    if (!text) return;
    const offset = i - (lines.length - 1) / 2;
    const yOffsetExpr = offset === 0 ? 0 : `${offset.toFixed(4)}*w*${lineHFrac.toFixed(6)}`;
    // When user set a sized cover box, force text color white-on-black/black-on-white
    // and strip inline box so it doesn't double-render.
    const textOverlay = hasUserSizedCover
      ? { ...overlay, text, bg: 'none',
          textColor: (overlay.bg === 'white' || overlay.bg === 'yellow') ? '#111111' : '#FFFFFF' }
      : { ...overlay, text };
    filters.push(buildSingleLine(textOverlay, yOffsetExpr));
  });

  return filters.filter(Boolean).join(',') || null;
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

async function enhanceVideo({ inputPath, srtContent, segments, textOverlays = [], burnSubtitles, subtitleStyle = 'standard', enhance, trim, adjustments, speed, cropRatio, qualityPreset, denoise, sharpness, upscale, brand }) {
  const uploadDir = getUploadDir();
  const outFilename = `enhanced_${uuidv4()}.mp4`;
  const outputPath = path.join(uploadDir, outFilename);

  const inputArgs = ['-y', '-threads', THREADS];
  const trimStart = Number(trim?.start) || 0;
  const trimEnd   = Number(trim?.end)   || 0;
  if (trimStart > 0) inputArgs.push('-ss', trimStart.toFixed(3));
  if (brand?.cardPath) inputArgs.splice(3, 0, '-loop', '1', '-i', brand.cardPath);  // input 0 = brand card image, input 1 = video
  inputArgs.push('-i', inputPath);
  if (trimEnd > trimStart && trimEnd > 0) {
    inputArgs.push('-t', (trimEnd - trimStart).toFixed(3));
  }

  const vFilters = [];
  const aFilters = [];

  // 1. Crop first (changes dimensions)
  const cropFilter = brand?.frame ? null : await computeCropFilter(inputPath, cropRatio);
  if (cropFilter) vFilters.push(cropFilter);

  // Brand layout: where the card and the (scaled) video sit on a 1080x1920 canvas
  let layout = null;
  let layoutQuality = 'best';
  if (brand?.cardPath) {
    const dims = await getVideoDimensions(inputPath);
    let sw = dims.width, sh = dims.height;
    if (brand.frame) {
      const f = frameCrop(dims.width, dims.height, brand.frame);   // user's TOP/BOTTOM crop + zoom (+ auto bar trim)
      vFilters.push(...f.filters); sw = f.w; sh = f.h;
    } else {
      const m = cropFilter && cropFilter.match(/^crop=(\d+):(\d+)/);
      if (m) { sw = Number(m[1]); sh = Number(m[2]); }
    }
    layout = computeLayout({ cardH: brand.cardH, srcW: sw, srcH: sh, offsetY: brand.frame?.offsetY });
    // Quality: 'best' = 1080x1920. 'fast' (default) = 720x1280, about 2.2x fewer pixels to encode.
    layoutQuality = brand.quality === 'best' ? 'best' : brand.quality === 'fast' ? 'fast' : (process.env.RENDER_QUALITY === 'best' ? 'best' : 'fast');
    const S = layoutQuality === 'best' ? 1 : 2 / 3;
    if (S !== 1) {
      const ev = (n) => Math.max(2, Math.round((n * S) / 2) * 2);
      layout = { canvasW: ev(layout.canvasW), canvasH: ev(layout.canvasH), cardX: ev(layout.cardX), cardY: ev(layout.cardY),
                 vidW: ev(layout.vidW), vidH: ev(layout.vidH), vidX: ev(layout.vidX), vidY: ev(layout.vidY), cardScaleW: ev(952) };
    }
  }

  // 2. Speed
  const spd = Number(speed) || 1;
  if (spd !== 1) {
    vFilters.push(`setpts=${(1 / spd).toFixed(6)}*PTS`);
    aFilters.push(`atempo=${spd}`);
  }

  // 3. Quality preset pipeline
  const PRESETS = {
    instagram: { dL:0,  dC:0,  dT:0,  sL:0.6, sC:0.2,  br:0.00, ct:1.00, sat:1.05, gm:1.0,  cas:0,    crf:'15', curves:false, deband:false, nlmeans:false },
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
  if (preset && (preset.dL > 0 || preset.dT > 0)) {
    // Reduced hqdn3d strength for lower memory usage
    vFilters.push(`hqdn3d=luma_spatial=${Math.min(preset.dL,2)}:chroma_spatial=${Math.min(preset.dC,1)}:luma_tmp=${Math.min(preset.dT,3)}:chroma_tmp=${(Math.min(preset.dT,3) * 0.85).toFixed(1)}`);
  } else if (denoiseStrength > 0) {
    const ls = denoiseStrength, cs = Math.max(0, denoiseStrength - 1), lt = denoiseStrength * 1.5, ct2 = denoiseStrength * 1.1;
    vFilters.push(`hqdn3d=luma_spatial=${ls}:chroma_spatial=${cs}:luma_tmp=${lt}:chroma_tmp=${ct2}`);
  }

  // Upscale with Lanczos
  if (layout) {
    // final scaling happens once, in the brand layout step below
  } else if (upscale && upscale !== 'none') {
    vFilters.push(`scale=${upscale}:flags=lanczos+accurate_rnd`);
  } else if (preset && textOverlays.length === 0) {
    vFilters.push("scale=w='if(gt(ih,iw),1080,min(1920,iw))':h=-2:flags=lanczos+accurate_rnd");
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

  // 7. Brand layout: scale video, place it on the canvas, overlay the card
  if (layout) {
    vFilters.push(
      `scale=${layout.vidW}:${layout.vidH}:flags=bicubic`,
      'setsar=1',
      `pad=${layout.canvasW}:${layout.canvasH}:${layout.vidX}:${layout.vidY}:color=${String(brand.canvasColor || '#000000').replace('#', '0x')}`
    );
  }

  const crf = preset?.crf || (layout ? (layoutQuality === 'best' ? '19' : '22') : enhance ? '18' : '23');
  const args = [...inputArgs];
  if (layout) {
    args.push(
      '-filter_complex',
      `${layout.cardScaleW ? `[0:v]scale=${layout.cardScaleW}:-2:flags=bicubic[cardimg];` : ''}[1:v]${vFilters.join(',')}[bg];[bg][${layout.cardScaleW ? 'cardimg' : '0:v'}]overlay=${layout.cardX}:${layout.cardY}:shortest=1,format=yuv420p[vout]`,
      '-map', '[vout]', '-map', '1:a?'
    );
  } else if (vFilters.length > 0) args.push('-vf', vFilters.join(','));
  if (aFilters.length > 0) args.push('-af', aFilters.join(','));

  // DEBUG LOGGING — remove after diagnosis
  logger.info(`[DEBUG] textOverlays received: ${JSON.stringify(textOverlays)}`);
  logger.info(`[DEBUG] vFilters chain: ${vFilters.join(',')}`);
  const probedDims = await getVideoDimensions(inputPath);
  logger.info(`[DEBUG] ffprobe dims: ${probedDims.width}x${probedDims.height}`);

  // Quality encode (High profile, 48kHz audio) - still single-thread for Render free tier
  args.push('-c:v', 'libx264');
  args.push('-preset', layout ? (layoutQuality === 'best' ? 'superfast' : 'ultrafast') : 'veryfast');
  args.push('-crf', crf);
  args.push('-threads', THREADS);
  args.push('-profile:v', 'high', '-level:v', '4.1');
  args.push('-pix_fmt', 'yuv420p');
  args.push('-maxrate', '12M', '-bufsize', '24M');
  args.push('-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709');
  args.push('-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', outputPath);

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

module.exports = { enhanceVideo, extractAudio, getVideoDuration, detectContentRect, detectMainVideoRect, extractFrames };
