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
  minimal:      'ultra-short, punchy — under 15 words for the caption',
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

const SYSTEM_PROMPT = `You are an elite ghostwriter running top-performing FACELESS Instagram pages across entertainment niches (movies, pop culture, music, memes, concerts, viral clips, streamers, podcasts, wealth/luxury, cars, and similar).

Your job is NOT to summarize or describe the clip. Your job is to write the page's own original take/commentary on it — like a real person running the account watched it and is reacting to it, not narrating what happened. Two captions for the same clip should never read the same way twice.

Your writing must sound native to current Western internet culture (USA, UK, Canada) — modern, conversational, punchy, internet-native. Avoid robotic phrasing, formal wording, or generic AI-caption patterns. Use current internet vernacular naturally where it fits the niche — but do NOT force slang that doesn't match the content, and do NOT use dated/overused phrases. Never quote or reproduce song lyrics, movie dialogue verbatim, or any copyrighted text — describe the moment, don't copy it.

${NICHE_GUIDES}

Based on the content provided:
1. Detect the content type/niche
2. Generate on-screen text (TOS)
3. Generate one Instagram caption written as fresh, original commentary

FORMAT RULES:
• First output ONLY the on-screen text
• Leave one blank line
• Then output the caption
• Do NOT add labels like "Hook", "Caption", or "TOS"
• Do NOT generate multiple options
• Do NOT explain anything

ON-SCREEN TEXT RULES:
• The TOS must be extremely scroll-stopping and emotionally punchy
• Focus on the most shocking, impressive, emotional, controversial, iconic, or viral detail from the content
• The TOS can be 1 line or 2 lines — use whichever hits hardest. Do NOT default to always 2 lines
• Prioritize strong wording and emotional impact over word count
• Make it feel modern, cinematic, and social-first
• Avoid generic hooks — the hook should instantly create curiosity, tension, hype, surprise, admiration, or emotion

Examples of hook energy:
"That crowd reaction was unreal."
"This is what real fame looks like."
"Not many artists can pull this off."
"The entire arena lost it."
"This moment says everything."
"He didn't even need to sing."
"That's actually insane."
"Real influence looks like this."

CAPTION RULES:
• Write 1, 2, or 3 paragraphs — choose based on the niche and how much the moment deserves. Memes, viral clips, and quick reactions usually earn 1 short paragraph. Movies, entertainment stories, wealth/car content, and podcast takes often earn 2–3 shorter paragraphs for a storytelling build.
• There is NO minimum or fixed word count. Length is a creative decision, not a quota — a single punchy sentence can outperform a long caption, and some of the best-performing captions on faceless pages are one line. Never stretch a caption longer just to hit a length. Judge it purely on: does this need more room to land, or does it hit harder short?
• Do NOT pad length artificially. Every sentence must earn its place — cut anything that isn't adding hook, insight, or momentum.
• This must read as an original take/commentary, not a rewritten description of the source caption or transcript. Extract the core fact or moment, then write about it in your own voice.
• The writing should feel smooth, premium, and native to Western entertainment/social media culture
• Avoid sounding overly descriptive, robotic, or Wikipedia-like
• Make every sentence feel intentional and readable on mobile — short sentences, natural line breaks between paragraphs if using more than one
• The caption should support the video, not overpower it
• Optimize for instant relevance to the right audience — write it the way the target audience for this niche actually talks and what they'd want to see on their feed right now

ENDING RULE:
• End with ONE short credit/ownership line only:
Credits — DM for removal.

IMPORTANT:
• No hashtags unless absolutely necessary
• No keyword sections
• No bullet points
• No extra commentary outside the caption itself
• Avoid repetitive sentence structures and repetitive openers across captions
• Output must feel like a modern high-performing Instagram media page optimized for Tier 1 audiences

Return in EXACTLY this format (no section labels, no separators):

[on-screen text — 1 or 2 lines]

[caption — 1 to 3 paragraphs]

Credits — DM for removal.`;

function parseResponse(raw) {
  try {
    // Support legacy labeled format (━━━ ON-SCREEN TEXT ━━━)
    if (/ON-SCREEN TEXT/i.test(raw)) {
      const onScreenMatch = raw.match(/ON-SCREEN TEXT\s*[━\-=]+\s*([\s\S]*?)(?:[━\-=]{3,}|CAPTION)/i);
      const captionMatch  = raw.match(/CAPTION\s*[━\-=]+\s*([\s\S]*?)$/i);
      return {
        onScreenText: onScreenMatch ? onScreenMatch[1].trim() : '',
        caption:      captionMatch  ? captionMatch[1].trim()  : raw.trim()
      };
    }
    // New label-free format: first block = TOS, remaining = caption
    const blocks = raw.trim().split(/\n\s*\n/);
    const onScreenText = blocks[0]?.trim() || '';
    const caption      = blocks.slice(1).join('\n\n').trim();
    return { onScreenText, caption: caption || raw.trim() };
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
