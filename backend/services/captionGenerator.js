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

const SYSTEM_PROMPT = `You are an elite ghostwriter running top-performing FACELESS Instagram pages across entertainment niches (movies, pop culture, music, memes, concerts, viral clips, streamers, podcasts, wealth/luxury, cars, and similar).

Your job is NOT to describe the clip frame by frame. Write the page's own original take on it, like a real person running the account who watched it and has something to say. Two captions for the same clip should never read the same way twice.

Your writing must sound native to current Western internet culture (USA, UK, Canada English) — modern, conversational, punchy, high-energy. Avoid robotic phrasing and generic AI-caption patterns. Never quote or reproduce song lyrics, movie dialogue verbatim, or any copyrighted text — describe the moment, don't copy it. Never invent stats, records, or facts that are not in the video, transcript, or original caption; if you are unsure of a number, speak about the significance instead.

${NICHE_GUIDES}

You MUST follow this EXACT structure for every video, no exceptions:

1. TEXT-ON-SCREEN (TOS)
• ONE short line, 8–14 words max, plus exactly 2 emojis
• Formula: [relatable scenario or high-stakes premise] + [punchline or ultimate outcome] + [2 emojis]
• Must create curiosity or trigger an emotional reaction (humor, nostalgia, awe, relatable truth) and stop the scroll

2. CAPTION PARAGRAPH 1 — THE HOOK & CONTEXT
• 1–2 sentences
• Instantly summarize the event/clip/song/news/idea with maximum energy
• Subject + core action + setting or timeframe, with 2–3 emojis

3. CAPTION PARAGRAPH 2 — THE DEEP DIVE & VALUE
• 2–3 sentences
• Give the key details, cultural significance, background, or why it matters (only facts you can support)
• 2–3 emojis

4. CAPTION PARAGRAPH 3 — CALL TO ACTION
• 1–2 sentences
• A low-friction, open-ended question related to the topic that drives comments, plus a short action line (e.g. "Let us know below! 👇")

5. CREDIT LINE
• Exactly this line: ${CREDIT_LINE}

6. HASHTAGS
• Exactly 5 to 7 hashtags on ONE line
• 2 broad category tags + 2 specific topic tags + 2 entity/name tags (add one extra only if clearly relevant)

OUTPUT FORMAT — return exactly this, with one blank line between each block, no labels, no headings, no bullet points, no explanations, no multiple options:

[TOS line]

[Paragraph 1]

[Paragraph 2]

[Paragraph 3]

${CREDIT_LINE}

[#hashtags on one line]`;

// Enforce the fixed format no matter what the model returns
function normalizeCaption(caption) {
  let text = (caption || '').replace(/\r/g, '').trim();

  // Pull hashtags out of the body
  const tags = [];
  text = text.replace(/#[\p{L}\p{N}_]+/gu, (m) => { if (!tags.includes(m)) tags.push(m); return ''; });

  // Remove any credit line variants, then re-add exactly one
  text = text
    .split('\n')
    .filter(line => !/^\s*credits?\b.*dm for removal/i.test(line))
    .join('\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const parts = [text, CREDIT_LINE];
  if (tags.length) parts.push(tags.slice(0, 7).join(' '));
  return parts.filter(Boolean).join('\n\n');
}

function parseResponse(raw) {
  try {
    const blocks = raw.trim().split(/\n\s*\n/);
    const onScreenText = (blocks[0] || '').replace(/^\s*(TOS|TEXT[- ]ON[- ]SCREEN)\s*[:\-]\s*/i, '').trim();
    const body = blocks.slice(1).join('\n\n').trim();
    return { onScreenText, caption: normalizeCaption(body || raw.trim()) };
  } catch {
    return { onScreenText: '', caption: raw.trim() };
  }
}

// Upload video to Gemini Files API and generate content using vision
async function generateWithGeminiVision({ videoPath, transcript, originalCaption, videoTitle, captionStyle, customPrompt }) {
  const { ai, fm } = getGemini();
  const style = customPrompt || STYLE_GUIDES[captionStyle] || STYLE_GUIDES.casual;

  logger.info('Uploading video to Gemini Files API...');
  let uploadedFile;
  try {
    const fs = require('fs');
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

    const extraContext = [
      videoTitle      && `Video title: ${videoTitle}`,
      originalCaption && `Original post caption: ${originalCaption.substring(0, 600)}`,
      transcript      && `Audio transcript: ${transcript.substring(0, 800)}`
    ].filter(Boolean).join('\n');

    const model = ai.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContent([
      { fileData: { mimeType: file.mimeType, fileUri: file.uri } },
      { text: `${SYSTEM_PROMPT}\n\nCaption style: ${style}\n\n${extraContext}\n\nGenerate the on-screen text and caption now:` }
    ]);

    return parseResponse(result.response.text());
  } finally {
    // Clean up uploaded file
    if (uploadedFile?.file?.name) {
      fm.deleteFile(uploadedFile.file.name).catch(() => {});
    }
  }
}

// Fallback: text-only generation via Groq
async function generateWithGroq({ transcript, originalCaption, videoTitle, captionStyle, customPrompt }) {
  const style = customPrompt || STYLE_GUIDES[captionStyle] || STYLE_GUIDES.casual;
  const context = [
    videoTitle      && `Video title: ${videoTitle}`,
    originalCaption && `Original post caption (use this to understand the specific moment): ${originalCaption.substring(0, 800)}`,
    transcript      && `Audio transcript (use this to identify who is speaking and what is happening): ${transcript.substring(0, 1200)}`
  ].filter(Boolean).join('\n');

 const completion = await getGroq().chat.completions.create({
    model: 'openai/gpt-oss-120b',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: `${context}\n\nCaption style: ${style}\n\nGenerate the on-screen text and caption now:` }
    ],
    max_tokens: 1200,
    temperature: 0.95
  });
  return parseResponse(completion.choices[0].message.content);
}

async function generateContent({ videoPath, transcript, originalCaption, videoTitle, captionStyle, customPrompt }) {
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
        return await generateWithGeminiVision({ videoPath, transcript, originalCaption, videoTitle, captionStyle, customPrompt });
      }
    }

    // Fall back to Groq text-only
    if (process.env.GROQ_API_KEY) {
      logger.info('Using Groq text-only for caption generation');
      return await generateWithGroq({ transcript, originalCaption, videoTitle, captionStyle, customPrompt });
    }

    return { caption: originalCaption || videoTitle || '', onScreenText: '' };
  } catch (err) {
    logger.error('Content generation failed:', err.message);
    // If Gemini fails, try Groq as fallback
    if (process.env.GROQ_API_KEY) {
      try {
        logger.info('Gemini failed, falling back to Groq...');
        return await generateWithGroq({ transcript, originalCaption, videoTitle, captionStyle, customPrompt });
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

module.exports = { generateContent, generateCaption, generateSubtitleLines };
