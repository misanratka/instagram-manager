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
// Borderless "tweet" look: text sits directly on the canvas colour (black for dark, white for light).
const THEMES = {
  dark:  { canvas: '#000000', name: '#ffffff', handle: '#71767b', text: '#ffffff', avatarBg: '#2f3336' },
  light: { canvas: '#ffffff', name: '#0f1419', handle: '#536471', text: '#0f1419', avatarBg: '#cfd9de' }
};
const BADGE_BLUE = '#1d9bf0';

const CANVAS_W = 1080;
const CANVAS_H = 1920;
const MARGIN = 64;                       // left/right margin shared by the card and the video
const CONTENT_W = CANVAS_W - MARGIN * 2; // 952
const CARD_W = CONTENT_W;

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
      while (ctx.measureText(word).width > maxW) {      // break a single over-long word
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
 * @param {{name:string, handle:string, verified?:boolean, avatar?:string, text:string, theme?:'dark'|'light', scale?:number}} o
 *        avatar = base64 data URL or raw base64 of a PNG/JPEG; scale = 0.8–1.5 (card size)
 * @returns {Promise<{buffer:Buffer, width:number, height:number}>}  transparent PNG, 952px wide
 */
async function renderCard(o) {
  setupFonts();
  const { createCanvas, loadImage } = lib();
  const th = THEMES[o.theme] || THEMES.dark;
  const k = Math.min(1.5, Math.max(0.8, Number(o.scale) || 1));
  const AV = Math.round(112 * k), GAP = Math.round(22 * k);
  const NAME_PX = Math.round(38 * k), HANDLE_PX = Math.round(29 * k), TEXT_PX = Math.round(46 * k), LINE_H = Math.round(58 * k);
  const MAX_LINES = 8;

  const probe = createCanvas(10, 10).getContext('2d');
  probe.font = fontStack(TEXT_PX, false);
  let lines = wrapText(probe, (o.text || '').trim(), CARD_W);
  if (lines.length > MAX_LINES) {
    lines = lines.slice(0, MAX_LINES);
    lines[MAX_LINES - 1] = lines[MAX_LINES - 1].replace(/\s*\S{0,3}$/, '') + '…';
  }
  const textTop = AV + Math.round(26 * k);
  const height = textTop + lines.length * LINE_H + 6;

  const canvas = createCanvas(CARD_W, height);
  const ctx = canvas.getContext('2d');

  // avatar
  ctx.save();
  ctx.beginPath(); ctx.arc(AV / 2, AV / 2, AV / 2, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
  let drewAvatar = false;
  if (o.avatar) {
    try {
      const raw = String(o.avatar).replace(/^data:image\/\w+;base64,/, '');
      const img = await loadImage(Buffer.from(raw, 'base64'));
      const sc = Math.max(AV / img.width, AV / img.height);        // cover-crop
      const w = img.width * sc, h = img.height * sc;
      ctx.drawImage(img, (AV - w) / 2, (AV - h) / 2, w, h);
      drewAvatar = true;
    } catch { /* fall through to initial */ }
  }
  if (!drewAvatar) {
    ctx.fillStyle = th.avatarBg; ctx.fillRect(0, 0, AV, AV);
    ctx.fillStyle = th.name; ctx.font = fontStack(Math.round(52 * k), true);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText((String(o.name || o.handle || '?').trim()[0] || '?').toUpperCase(), AV / 2, AV / 2 + 3);
  }
  ctx.restore();

  // name + badge + handle (vertically centred next to the avatar)
  const tx = AV + GAP;
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  ctx.font = fontStack(NAME_PX, true);
  const badge = Math.round(NAME_PX * 1.0);
  const maxNameW = CARD_W - tx - (o.verified ? badge + 16 : 0);
  const rawName = String(o.name || '').trim();
  let nameStr = rawName;
  while (nameStr.length > 1 && ctx.measureText(nameStr).width > maxNameW) nameStr = nameStr.slice(0, -1);
  if (nameStr !== rawName) nameStr = nameStr.replace(/\s*\S?$/, '') + '…';
  const nameBase = Math.round(AV / 2 - 4 * k);
  ctx.fillStyle = th.name;
  ctx.fillText(nameStr, tx, nameBase);
  if (o.verified) {
    const nw = ctx.measureText(nameStr).width;
    drawVerifiedBadge(ctx, tx + nw + 12 + badge / 2, nameBase - NAME_PX * 0.32, badge);
  }
  ctx.font = fontStack(HANDLE_PX, false);
  ctx.fillStyle = th.handle;
  ctx.fillText(`@${String(o.handle || '').replace(/^@+/, '')}`, tx, nameBase + Math.round(HANDLE_PX * 1.35));

  // text
  ctx.font = fontStack(TEXT_PX, false);
  ctx.fillStyle = th.text;
  lines.forEach((ln, i) => ctx.fillText(ln, 0, textTop + Math.round(TEXT_PX * 0.95) + i * LINE_H));

  return { buffer: canvas.toBuffer('image/png'), width: CARD_W, height, canvasColor: th.canvas };
}

/**
 * Where everything sits on the 1080x1920 canvas.
 * Card + video are stacked as one group and centred vertically (card upper-middle, video lower-middle).
 * offsetY (px, + = lower) moves the whole group.
 */
function computeLayout({ cardH, srcW, srcH, offsetY = 0 }) {
  const SAFE_TOP = 110, SAFE_BOTTOM = 170, GAP = 24;
  const availH = CANVAS_H - SAFE_TOP - SAFE_BOTTOM - cardH - GAP;
  const s = Math.min(CONTENT_W / srcW, availH / srcH);
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  const vidW = even(srcW * s), vidH = even(srcH * s);
  const groupH = cardH + GAP + vidH;
  const centred = Math.round((CANVAS_H - groupH) / 2) + (Number(offsetY) || 0);
  const top = Math.min(Math.max(40, centred), CANVAS_H - groupH - 40);
  return {
    canvasW: CANVAS_W, canvasH: CANVAS_H,
    cardX: MARGIN, cardY: top,
    vidW, vidH, vidX: MARGIN + Math.round((CONTENT_W - vidW) / 2), vidY: top + cardH + GAP
  };
}

function canvasColorFor(theme) { return (THEMES[theme] || THEMES.dark).canvas; }

module.exports = { renderCard, computeLayout, canvasColorFor, CANVAS_W, CANVAS_H, CARD_W, MARGIN };
