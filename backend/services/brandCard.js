// Renders the "tweet-style" brand card (avatar, name, verified badge, @handle, text) to a PNG,
// and computes where the card and the video sit on the 1080x1920 canvas.
// Uses @napi-rs/canvas (Skia) so colour emoji, text wrapping and the circular avatar render properly.
const fs = require('fs');
const path = require('path');

let canvasLib = null;
function lib() {
  if (!canvasLib) canvasLib = require('@napi-rs/canvas');
  return canvasLib;
}

// ── Fonts ─────────────────────────────────────────────────────────────────────
const FONT_DIRS = ['/usr/share/fonts/truetype', '/usr/share/fonts/opentype', '/usr/share/fonts'];
function findFont(names) {
  for (const dir of [process.env.CARD_FONT_DIR, ...FONT_DIRS].filter(Boolean)) {
    for (const n of names) {
      const direct = path.join(dir, n);
      if (fs.existsSync(direct)) return direct;
      for (const sub of ['liberation', 'dejavu', 'noto']) {
        const p = path.join(dir, sub, n);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  return null;
}

let fontsReady = false;
let SANS = 'sans-serif';
function setupFonts() {
  if (fontsReady) return;
  fontsReady = true;
  const { GlobalFonts } = lib();
  const reg = findFont(['LiberationSans-Regular.ttf']);
  const bold = findFont(['LiberationSans-Bold.ttf']);
  if (reg && bold) {
    GlobalFonts.registerFromPath(reg, 'CardSans');
    GlobalFonts.registerFromPath(bold, 'CardSans');
    SANS = 'CardSans';
  } else {
    const dj = findFont(['DejaVuSans.ttf']);
    const djb = findFont(['DejaVuSans-Bold.ttf']);
    if (dj) { GlobalFonts.registerFromPath(dj, 'CardSans'); SANS = 'CardSans'; }
    if (djb) GlobalFonts.registerFromPath(djb, 'CardSans');
  }
  const emoji = process.env.EMOJI_FONT_PATH || findFont(['NotoColorEmoji.ttf']);
  if (emoji && fs.existsSync(emoji)) GlobalFonts.registerFromPath(emoji, 'CardEmoji');
}
const fontStack = (px, bold) => `${bold ? 'bold ' : ''}${px}px "${SANS}", "CardEmoji", "Noto Color Emoji", sans-serif`;

// ── Themes ────────────────────────────────────────────────────────────────────
const THEMES = {
  dark:  { bg: '#16181c', border: '#2f3336', name: '#e7e9ea', handle: '#71767b', text: '#e7e9ea', avatarBg: '#2f3336' },
  light: { bg: '#ffffff', border: '#cfd9de', name: '#0f1419', handle: '#536471', text: '#0f1419', avatarBg: '#cfd9de' }
};
const BADGE_BLUE = '#1d9bf0';

const CANVAS_W = 1080;
const CANVAS_H = 1920;
const CARD_W = 960;

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawVerifiedBadge(ctx, cx, cy, size) {
  const side = size * 0.74;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.fillStyle = BADGE_BLUE;
  for (const rot of [0, Math.PI / 4]) {          // two rounded squares = 8-point seal
    ctx.save();
    ctx.rotate(rot);
    roundRectPath(ctx, -side / 2, -side / 2, side, side, side * 0.3);
    ctx.fill();
    ctx.restore();
  }
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = size * 0.11;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(-size * 0.17, size * 0.01);
  ctx.lineTo(-size * 0.04, size * 0.15);
  ctx.lineTo(size * 0.2, -size * 0.14);
  ctx.stroke();
  ctx.restore();
}

// Wrap text to a pixel width. Handles explicit newlines, long words and emoji (grapheme-safe via Array.from).
function wrapText(ctx, text, maxW) {
  const lines = [];
  for (const para of String(text).replace(/\r/g, '').split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(''); continue; }
    let line = '';
    for (let word of words) {
      // break a single over-long word
      while (ctx.measureText(word).width > maxW) {
        const chars = Array.from(word);
        let cut = chars.length - 1;
        while (cut > 1 && ctx.measureText(chars.slice(0, cut).join('')).width > maxW) cut--;
        if (line) { lines.push(line); line = ''; }
        lines.push(chars.slice(0, cut).join(''));
        word = chars.slice(cut).join('');
      }
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width <= maxW) line = test;
      else { lines.push(line); line = word; }
    }
    if (line) lines.push(line);
  }
  return lines;
}

/**
 * @param {{name:string, handle:string, verified?:boolean, avatar?:string, text:string, theme?:'dark'|'light'}} o
 *        avatar = base64 data URL or raw base64 of a PNG/JPEG
 * @returns {Promise<{buffer:Buffer, width:number, height:number}>}
 */
async function renderCard(o) {
  setupFonts();
  const { createCanvas, loadImage } = lib();
  const th = THEMES[o.theme] || THEMES.dark;
  const PAD = 40, AV = 104, GAP = 26, RADIUS = 40;
  const NAME_PX = 40, HANDLE_PX = 34, TEXT_PX = 46, LINE_H = 64, MAX_LINES = 8;
  const innerW = CARD_W - PAD * 2;

  // measure text first so the card height fits
  const probe = createCanvas(10, 10).getContext('2d');
  probe.font = fontStack(TEXT_PX, false);
  let lines = wrapText(probe, (o.text || '').trim(), innerW);
  if (lines.length > MAX_LINES) {
    lines = lines.slice(0, MAX_LINES);
    lines[MAX_LINES - 1] = lines[MAX_LINES - 1].replace(/\s*\S{0,3}$/, '') + '…';
  }
  const headerH = AV;
  const textTop = PAD + headerH + 30;
  const height = textTop + lines.length * LINE_H + PAD - 6;

  const canvas = createCanvas(CARD_W, height);
  const ctx = canvas.getContext('2d');

  // card body
  roundRectPath(ctx, 1, 1, CARD_W - 2, height - 2, RADIUS);
  ctx.fillStyle = th.bg; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = th.border; ctx.stroke();

  // avatar
  const ax = PAD, ay = PAD;
  ctx.save();
  ctx.beginPath(); ctx.arc(ax + AV / 2, ay + AV / 2, AV / 2, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
  let drewAvatar = false;
  if (o.avatar) {
    try {
      const raw = String(o.avatar).replace(/^data:image\/\w+;base64,/, '');
      const img = await loadImage(Buffer.from(raw, 'base64'));
      const s = Math.max(AV / img.width, AV / img.height);        // cover-crop
      const w = img.width * s, h = img.height * s;
      ctx.drawImage(img, ax + (AV - w) / 2, ay + (AV - h) / 2, w, h);
      drewAvatar = true;
    } catch { /* fall through to initial */ }
  }
  if (!drewAvatar) {
    ctx.fillStyle = th.avatarBg; ctx.fillRect(ax, ay, AV, AV);
    ctx.fillStyle = th.name; ctx.font = fontStack(52, true);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText((String(o.name || o.handle || '?').trim()[0] || '?').toUpperCase(), ax + AV / 2, ay + AV / 2 + 3);
  }
  ctx.restore();

  // name + badge + handle
  const tx = ax + AV + GAP;
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.font = fontStack(NAME_PX, true);
  const maxNameW = CARD_W - tx - PAD - (o.verified ? 50 : 0);
  let nameStr = String(o.name || '').trim();
  while (nameStr.length > 1 && ctx.measureText(nameStr).width > maxNameW) nameStr = nameStr.slice(0, -1);
  if (nameStr !== String(o.name || '').trim()) nameStr = nameStr.replace(/\s*\S?$/, '') + '…';
  const nameBase = ay + 44;
  ctx.fillStyle = th.name;
  ctx.fillText(nameStr, tx, nameBase);
  if (o.verified) {
    const nw = ctx.measureText(nameStr).width;
    drawVerifiedBadge(ctx, tx + nw + 14 + 22, nameBase - 14, 44);
  }
  ctx.font = fontStack(HANDLE_PX, false);
  ctx.fillStyle = th.handle;
  const handle = `@${String(o.handle || '').replace(/^@+/, '')}`;
  ctx.fillText(handle, tx, nameBase + 46);

  // text
  ctx.font = fontStack(TEXT_PX, false);
  ctx.fillStyle = th.text;
  lines.forEach((ln, i) => ctx.fillText(ln, PAD, textTop + 44 + i * LINE_H));

  return { buffer: canvas.toBuffer('image/png'), width: CARD_W, height };
}

/**
 * Where everything sits on the 1080x1920 canvas.
 * Card + video are stacked as one group and centred vertically: card upper-middle, video lower-middle.
 */
function computeLayout({ cardH, srcW, srcH }) {
  const SAFE_TOP = 130, SAFE_BOTTOM = 170, GAP = 36;
  const availH = CANVAS_H - SAFE_TOP - SAFE_BOTTOM - cardH - GAP;
  const s = Math.min(CANVAS_W / srcW, availH / srcH);
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  const vidW = even(srcW * s), vidH = even(srcH * s);
  const groupH = cardH + GAP + vidH;
  const top = Math.max(SAFE_TOP, Math.round((CANVAS_H - groupH) / 2));
  return {
    canvasW: CANVAS_W, canvasH: CANVAS_H,
    cardX: Math.round((CANVAS_W - CARD_W) / 2), cardY: top,
    vidW, vidH, vidX: Math.round((CANVAS_W - vidW) / 2), vidY: top + cardH + GAP
  };
}

module.exports = { renderCard, computeLayout, CANVAS_W, CANVAS_H, CARD_W };
