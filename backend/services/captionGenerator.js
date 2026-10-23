const Groq = require('groq-sdk');
const { GoogleGenerativeAI, GoogleAIFileManager } = require('@google/generative-ai');
const logger = require('./logger');

let groqClient;
function getGroq() {
  if (!groqClient) groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return groqClient;
}

let geminiAI, geminiFileManager;
function getGemini() {
  if (!geminiAI) {
    geminiAI        = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    geminiFileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);
  }
  return { ai: geminiAI, fm: geminiFileManager };
}

const STYLE_GUIDES = {
  casual:       'casual, friendly, relatable — like a popular entertainment page',
  professional: 'authoritative, polished, editorial — like a premium media outlet',
  funny:        'witty, humorous, meme-friendly — like a viral comedy page',
  motivational: 'inspiring, uplifting — like a cinematic fan page',
  minimal:      'ultra-punchy, short sentences, zero filler (the fixed format below still applies)',
  educational:  'informative, storytelling-focused — like a culture/nostalgia page'
};

// Niche voice guides — the model auto-detects which of these fits the
// content and blends it with the base viral-caption rules below.
const NICHE_GUIDES = `
NICHE VOICE CALIBRATION (auto-detect which niche this content belongs to, then write in that register):

• Movies / Film clips → cinematic, dramatic build-up, treat the scene like a moment worth rewatching
• Entertainment / Celebrity → insider tone, like you're putting the audience onto something they'd want to know
• Pop culture → fast, current, plugged-in — references the cultural moment, not just the clip
• Music / Songs → describe the *feeling* and impact of the moment (never quote or reproduce lyrics)
• Memes → short, deadpan or chaotic energy, minimal explanation, let the humor breathe
• Concerts / Live performance → high-energy, crowd/atmosphere-focused, "you had to be there" feeling
• Viral videos → curiosity-first, reaction-bait, built to make someone stop scrolling
• Streamers / Clips → casual insider community tone, like you already know the streamer's audience
• Podcasts → conversational, quote-the-vibe-not-the-words, framed around the take or moment being discussed
• Wealth / Luxury → aspirational, confident, slightly flexy but not cringe
• Cars → technical respect + aspirational tone, speaks to enthusiasts without over-explaining specs

If the content doesn't clearly match one niche, blend the closest two rather than defaulting to generic.
`;

const CREDIT_LINE = 'Credits — DM for removal.';

const PROMPT_HEAD = `You are an elite ghostwriter running top-performing FACELESS Instagram pages across entertainment niches (movies, pop culture, music, memes, concerts, viral clips, streamers, podcasts, wealth/luxury, cars, and similar).

Your job is NOT to describe the clip frame by frame. Write the page's own original take on it, like a real person running the account who watched it and has something to say. Two captions for the same clip should never read the same way twice.

Your writing must sound native to current Western internet culture (USA, UK, Canada English) — modern, conversational, punchy, high-energy. Avoid robotic phrasing and generic AI-caption patterns. Never quote or reproduce song lyrics, movie dialogue verbatim, or any copyrighted text — describe the moment, don't copy it. Never invent stats, records, or facts that are not in the video, transcript, or original caption; if you are unsure of a number, speak about the significance instead.

${NICHE_GUIDES}

You MUST follow this EXACT structure for every video, no exceptions:

1. TEXT-ON-SCREEN (TOS)
• ONE short line, 8–14 words max, plus exactly 2 emojis
• Formula: [relatable scenario or high-stakes premise] + [punchline or ultimate outcome] + [2 emojis]
• Must create curiosity or trigger an emotional reaction (humor, nostalgia, awe, relatable truth) and stop the scroll

2. CAPTION PARAGRAPH 1 — THE HOOK & CONTEXT
• 2–3 sentences
• Instantly summarize the event/clip/song/news/idea with maximum energy
• Subject + core action + setting or timeframe, with 2–3 emojis

3. CAPTION PARAGRAPH 2 — THE DEEP DIVE & VALUE
• 4–6 sentences — this is the detailed part: who/what is involved, what exactly happens, the background or backstory, the cultural significance, and why it matters right now
• Only facts you can support from the video, transcript, original caption, or verified context. Depth must come from insight, context, and significance — never from invented stats, dates, quotes, or records
• 2–3 emojis

4. CAPTION PARAGRAPH 3 — CALL TO ACTION
• 2 sentences
• A low-friction, open-ended question related to the topic that drives comments, plus a short action line (e.g. "Let us know below! 👇")

`;

const PROMPT_MENTIONS = `MENTIONS / TAGGING RULES:
• You may @tag a person or account ONLY if its handle appears in the VERIFIED HANDLES list provided in the user message, and only when that person is clearly featured in the content or is the clip's credited source
• Copy the handle exactly as listed. NEVER guess, recall from memory, or invent an Instagram handle — a wrong tag is worse than no tag
• NEVER identify a person from their face or appearance. Use names only when they appear in the title, original caption, or transcript
• If no verified handle applies, include NO @ tags at all. Maximum 3 tags from the verified list, placed naturally inside paragraph 1 or 2. REQUIRED MENTIONS from the page owner do not count toward this limit and must always be included

`;

const PROMPT_OPTIONS = `POST-SPECIFIC OPTIONS:
• If the user message contains POST-SPECIFIC INSTRUCTIONS, MUST-INCLUDE TEXT or REQUIRED MENTIONS, follow them for this post.
• MUST-INCLUDE TEXT goes inside paragraphs 1–3 exactly as written, character for character. Never alter it and never put it in the TOS line.
• Instructions can change focus, tone, emphasis and details, but never override the rules against inventing facts, quoting copyrighted text or guessing handles. Keep the block structure unless the instructions explicitly ask for a different length or format.
• The ACCOUNT STYLE (if given in "Caption style") controls voice, tone and wording. The block structure stays the same.`;

// Hashtags are OFF by default. Credit line only when reposting someone else's clip (or when asked).
function buildSystemPrompt({ creditLine, aiHashtags }) {
  let n = 5;
  const parts = [PROMPT_HEAD];
  if (creditLine) parts.push(`${n++}. CREDIT LINE\n• Exactly this line: ${CREDIT_LINE}\n\n`);
  if (aiHashtags) {
    parts.push(`${n++}. HASHTAGS\n• Exactly 5 to 7 hashtags on ONE line\n• 2 broad category tags + 2 specific topic tags + 2 entity/name tags (add one extra only if clearly relevant)\n\n`);
  } else {
    parts.push('NO HASHTAGS: do not include any hashtag (#) anywhere in the output.\n\n');
  }
  parts.push(PROMPT_MENTIONS, PROMPT_OPTIONS, '\n\n');
  parts.push('OUTPUT FORMAT — return exactly this, with one blank line between each block, no labels, no headings, no bullet points, no explanations, no multiple options:\n\n[TOS line]\n\n[Paragraph 1]\n\n[Paragraph 2]\n\n[Paragraph 3]');
  if (creditLine) parts.push(`\n\n${CREDIT_LINE}`);
  if (aiHashtags) parts.push('\n\n[#hashtags on one line]');
  return parts.join('');
}

let CURATED_HANDLES = {};
try { CURATED_HANDLES = require('./celebrityHandles'); } catch { /* optional file */ }

// ── Per-post caption options (all optional) ───────────────────────────────────
// Accepts what the web UI sends AND what a bot/API client might send:
// strings or arrays, with or without @ / #, booleans as true/"true"/"1".
const MAX_INSTRUCTIONS = 1000;

function toList(v, splitter) {
  if (v === undefined || v === null) return [];
  const arr = Array.isArray(v) ? v : String(v).split(splitter);
  return arr.map(x => String(x).trim()).filter(Boolean);
}
function toBool(v, fallback) {
  if (v === undefined || v === null || v === '') return fallback;
  if (typeof v === 'boolean') return v;
  return ['true', '1', 'yes', 'on'].includes(String(v).toLowerCase());
}
function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function sanitizeOptions(raw = {}) {
  raw = raw || {};
  const instructions = [raw.instructions, raw.tweak]
    .map(x => String(x || '').trim()).filter(Boolean).join('\n').slice(0, MAX_INSTRUCTIONS);

  const mustInclude = toList(raw.mustInclude, /\n+/).map(t => t.slice(0, 300)).slice(0, 5);

  const mentions = [];
  for (const tok of toList(raw.mentions, /[\s,]+/)) {
    const h = tok.replace(/^@+/, '').replace(/\.+$/, '');
    if (/^[A-Za-z0-9._]{2,30}$/.test(h) && !mentions.some(m => m.toLowerCase() === h.toLowerCase())) mentions.push(h);
  }

  const hashtags = [];
  for (const tok of toList(raw.hashtags, /[\s,]+/)) {
    const t = tok.replace(/^#+/, '');
    if (/^[\p{L}\p{N}_]{1,50}$/u.test(t) && !hashtags.some(x => x.toLowerCase() === t.toLowerCase())) hashtags.push(t);
  }

  return {
    instructions,
    mustInclude,
    mentions: mentions.slice(0, 10),
    hashtags: hashtags.slice(0, 15).map(t => `#${t}`),
    aiHashtags: toBool(raw.aiHashtags, false),
    creditLine: toBool(raw.creditLine, true)
  };
}

function buildOptionsBlock(o) {
  const out = [];
  if (o.instructions) out.push(`POST-SPECIFIC INSTRUCTIONS FROM THE PAGE OWNER (follow these for this post):\n${o.instructions}`);
  if (o.mustInclude.length) {
    out.push(`MUST-INCLUDE TEXT (put each one inside the caption body word-for-word, exactly as written — no paraphrasing, no changes to casing or punctuation):\n${o.mustInclude.map((t, i) => `${i + 1}. ${t}`).join('\n')}`);
  }
  if (o.mentions.length) out.push(`REQUIRED MENTIONS (tag every one, written exactly as shown):\n${o.mentions.map(h => `@${h}`).join(' ')}`);
  return out.join('\n\n');
}

// Account style = base voice + the page's saved writing style (if any).
function resolveStyle(captionStyle, customPrompt) {
  const base = STYLE_GUIDES[captionStyle] || STYLE_GUIDES.casual;
  const custom = (customPrompt || '').trim();
  return custom ? `${base}. ACCOUNT STYLE — this defines this page's voice, follow it closely: ${custom}` : base;
}

// Build the only set of handles the model is allowed to tag.
// Sources: (1) handles the page owner typed in "required mentions",
//          (2) @mentions already in the source post/title (real handles),
//          (3) your own verified list in services/celebrityHandles.js, matched by name in the text.
function buildHandleContext({ videoTitle, originalCaption, transcript, mentions = [] }) {
  const text = [videoTitle, originalCaption, transcript].filter(Boolean).join('\n');
  const found = new Map(); // lowercase handle -> { handle, note }

  for (const m of text.matchAll(/(?<![\w.])@([A-Za-z0-9._]{2,30})/g)) {
    const h = m[1].replace(/\.+$/, '');
    if (h && !found.has(h.toLowerCase())) found.set(h.toLowerCase(), { handle: h, note: 'mentioned in the source post' });
  }
  const lower = text.toLowerCase();
  for (const [name, handle] of Object.entries(CURATED_HANDLES || {})) {
    const h = String(handle || '').replace(/^@/, '');
    if (h && lower.includes(name.toLowerCase())) found.set(h.toLowerCase(), { handle: h, note: `verified handle for ${name}` });
  }
  for (const h of mentions) found.set(h.toLowerCase(), { handle: h, note: 'REQUIRED by the page owner' });

  const allowed = new Set([...found.keys()]);
  const list = [...found.values()].map(v => `@${v.handle} (${v.note})`).join('\n');
  const textBlock = list
    ? `VERIFIED HANDLES (the ONLY handles you may tag):\n${list}`
    : 'VERIFIED HANDLES: none — do not include any @ tags.';
  return { allowed, textBlock };
}

function stripUnverifiedMentions(text, allowed, required = new Set()) {
  let kept = 0;
  return text.replace(/(?<![\w.])@([A-Za-z0-9._]{2,30})/g, (full, h) => {
    const clean = h.replace(/\.+$/, '').toLowerCase();
    if (required.has(clean)) return full;
    if (allowed && allowed.has(clean) && kept < 3) { kept++; return full; }
    return ''; // drop unverified tag entirely
  }).replace(/[ \t]{2,}/g, ' ').replace(/ +([,.!?])/g, '$1');
}

// Enforce the fixed format no matter what the model returns
function normalizeCaption(caption, allowed, o) {
  let text = (caption || '').replace(/\r/g, '').trim();

  // Protect must-include phrases (even near-matches in casing/spacing) so the cleanup
  // steps below can't touch their #, @ or spacing. They are restored exactly as typed.
  const masks = o.mustInclude.map((phrase, i) => ({
    phrase,
    token: `⟦${i}⟧`,
    re: new RegExp(escapeRe(phrase).replace(/\s+/g, '\\s+'), 'i')
  }));
  for (const m of masks) text = text.replace(m.re, m.token);

  const required = new Set(o.mentions.map(h => h.toLowerCase()));
  text = stripUnverifiedMentions(text, allowed, required);

  // Pull model hashtags out of the body
  const modelTags = [];
  text = text.replace(/#[\p{L}\p{N}_]+/gu, (m) => { if (!modelTags.includes(m)) modelTags.push(m); return ''; })
             .replace(/[ \t]{2,}/g, ' ');

  // Remove any credit line variants (re-added below only if wanted)
  text = text
    .split('\n')
    .filter(line => !/^\s*credits?\b.*dm for removal/i.test(line))
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  // Restore must-include text exactly; append any the model left out
  const parts = [];
  const missing = [];
  for (const m of masks) {
    if (text.includes(m.token)) text = text.split(m.token).join(m.phrase);
    else missing.push(m.phrase);
  }
  parts.push(text, ...missing);

  // Required mentions the model left out → add on their own line
  const joined = parts.join('\n');
  const missingMentions = o.mentions.filter(h =>
    !new RegExp(`(?<![\\w.])@${escapeRe(h)}(?![A-Za-z0-9_]|\\.[A-Za-z0-9_])`, 'i').test(joined));
  if (missingMentions.length) parts.push(missingMentions.map(h => `@${h}`).join(' '));

  if (o.creditLine) parts.push(CREDIT_LINE);

  const tags = [];
  const addTag = (t) => { if (!tags.some(x => x.toLowerCase() === t.toLowerCase())) tags.push(t); };
  if (o.aiHashtags) modelTags.slice(0, 7).forEach(addTag);
  o.hashtags.forEach(addTag);
  if (tags.length) parts.push(tags.join(' '));

  return parts.filter(Boolean).join('\n\n');
}

function parseResponse(raw, allowed, o) {
  try {
    const required = new Set(o.mentions.map(h => h.toLowerCase()));
    const blocks = raw.trim().split(/\n\s*\n/);
    const onScreenText = stripUnverifiedMentions(
      (blocks[0] || '').replace(/^\s*(TOS|TEXT[- ]ON[- ]SCREEN)\s*[:\-]\s*/i, '').replace(/#[\p{L}\p{N}_]+/gu, '').trim(),
      allowed, required);
    const body = blocks.slice(1).join('\n\n').trim();
    return { onScreenText, caption: normalizeCaption(body || raw.trim(), allowed, o) };
  } catch {
    return { onScreenText: '', caption: raw.trim() };
  }
}

// Upload video to Gemini Files API and generate content using vision
async function generateWithGeminiVision({ videoPath, transcript, originalCaption, videoTitle, captionStyle, customPrompt, o }) {
  const { ai, fm } = getGemini();
  const style = resolveStyle(captionStyle, customPrompt);

  logger.info('Uploading video to Gemini Files API...');
  let uploadedFile;
  try {
    const mime = videoPath.endsWith('.webm') ? 'video/webm' : 'video/mp4';
    uploadedFile = await fm.uploadFile(videoPath, { mimeType: mime, displayName: 'video' });

    // Wait for file to be ready (Gemini processes it)
    let file = await fm.getFile(uploadedFile.file.name);
    let attempts = 0;
    while (file.state === 'PROCESSING' && attempts < 20) {
      await new Promise(r => setTimeout(r, 3000));
      file = await fm.getFile(uploadedFile.file.name);
      attempts++;
    }
    if (file.state !== 'ACTIVE') throw new Error(`Gemini file not ready: ${file.state}`);
    logger.info('Gemini file ready, generating content...');

    const { allowed, textBlock } = buildHandleContext({ videoTitle, originalCaption, transcript, mentions: o.mentions });
    const extraContext = [
      videoTitle      && `Video title: ${videoTitle}`,
      originalCaption && `Original post caption: ${originalCaption.substring(0, 1200)}`,
      transcript      && `Audio transcript: ${transcript.substring(0, 1500)}`,
      textBlock,
      buildOptionsBlock(o)
    ].filter(Boolean).join('\n\n');

    const model = ai.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.5-flash' });
    const result = await model.generateContent([
      { fileData: { mimeType: file.mimeType, fileUri: file.uri } },
      { text: `${buildSystemPrompt(o)}\n\nCaption style: ${style}\n\n${extraContext}\n\nGenerate the on-screen text and caption now:` }
    ]);

    return parseResponse(result.response.text(), allowed, o);
  } finally {
    // Clean up uploaded file
    if (uploadedFile?.file?.name) {
      fm.deleteFile(uploadedFile.file.name).catch(() => {});
    }
  }
}

// Fallback: text-only generation via Groq
async function generateWithGroq({ transcript, originalCaption, videoTitle, captionStyle, customPrompt, o }) {
  const style = resolveStyle(captionStyle, customPrompt);
  const { allowed, textBlock } = buildHandleContext({ videoTitle, originalCaption, transcript, mentions: o.mentions });
  const context = [
    videoTitle      && `Video title: ${videoTitle}`,
    originalCaption && `Original post caption (use this to understand the specific moment): ${originalCaption.substring(0, 1200)}`,
    transcript      && `Audio transcript (use this to identify who is speaking and what is happening): ${transcript.substring(0, 1800)}`,
    textBlock,
    buildOptionsBlock(o)
  ].filter(Boolean).join('\n\n');

  const completion = await getGroq().chat.completions.create({
    model: 'openai/gpt-oss-120b',
    messages: [
      { role: 'system', content: buildSystemPrompt(o) },
      { role: 'user',   content: `${context}\n\nCaption style: ${style}\n\nGenerate the on-screen text and caption now:` }
    ],
    max_tokens: 1800,
    temperature: 0.95
  });
  return parseResponse(completion.choices[0].message.content, allowed, o);
}

async function generateContent({ videoPath, transcript, originalCaption, videoTitle, captionStyle, customPrompt, options }) {
  const o = sanitizeOptions(options);

  // No API keys at all
  if (!process.env.GROQ_API_KEY && !process.env.GEMINI_API_KEY) {
    return {
      caption: originalCaption || videoTitle || 'Check this out!\n\nDM for credit or removal request.\nI do not own the rights to this video.\nAll rights belong to their respective owners.',
      onScreenText: ''
    };
  }

  try {
    // Use Gemini vision if we have a video file and API key
    if (videoPath && process.env.GEMINI_API_KEY) {
      const fs = require('fs');
      if (fs.existsSync(videoPath)) {
        logger.info('Using Gemini vision for caption generation');
        return await generateWithGeminiVision({ videoPath, transcript, originalCaption, videoTitle, captionStyle, customPrompt, o });
      }
    }

    // Fall back to Groq text-only
    if (process.env.GROQ_API_KEY) {
      logger.info('Using Groq text-only for caption generation');
      return await generateWithGroq({ transcript, originalCaption, videoTitle, captionStyle, customPrompt, o });
    }

    return { caption: originalCaption || videoTitle || '', onScreenText: '' };
  } catch (err) {
    logger.error('Content generation failed:', err.message);
    // If Gemini fails, try Groq as fallback
    if (process.env.GROQ_API_KEY) {
      try {
        logger.info('Gemini failed, falling back to Groq...');
        return await generateWithGroq({ transcript, originalCaption, videoTitle, captionStyle, customPrompt, o });
      } catch (e) {
        logger.error('Groq fallback also failed:', e.message);
      }
    }
    return { caption: originalCaption || videoTitle || '', onScreenText: '' };
  }
}

async function generateCaption(opts) {
  const { caption } = await generateContent(opts);
  return caption;
}

async function generateSubtitleLines({ transcript, segments }) {
  if (!transcript && (!segments || segments.length === 0)) return [];
  return segments || [];
}

module.exports = { generateContent, generateCaption, generateSubtitleLines, sanitizeOptions };
