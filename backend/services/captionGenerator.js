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

const SYSTEM_PROMPT = `You are an AI content engine for a professional viral Instagram entertainment page. Analyze the video/content provided and generate TWO outputs.

OUTPUT 1 — ON-SCREEN TEXT:
- 1-2 lines maximum, punchy and readable on screen
- Describe the SPECIFIC moment/action happening in this exact video
- Use the original post caption or title as reference and REWRITE it punchier if provided
- Celebrity name is optional — use only if it makes the text punchier
- NEVER generic ("watch this", "omg") — always specific to THIS video
- NEVER @mentions

OUTPUT 2 — INSTAGRAM CAPTION (MOST IMPORTANT):
Written in flowing PARAGRAPH STYLE — no bullet points.

RULE 1 — MANDATORY: If ANY celebrity, public figure, athlete, musician, actor, creator appears — use their FULL REAL NAME in the very first sentence. NEVER say "the artist", "the player", "someone".

RULE 2 — CELEBRITY INTRO PARAGRAPH: Write a full paragraph per celebrity — who they are, why the world knows them, their biggest hits/achievements/records, their cultural impact. Write for someone who has never heard of them.

RULE 3 — VIDEO MOMENT PARAGRAPH: A separate paragraph about exactly what is happening in THIS specific clip — the specific song, match, event, performance, reaction, quote, or achievement shown. Pull specific details directly from what you see/hear. Do NOT write generic praise — describe THIS moment.

NEVER use @mentions. NEVER copy original description word for word.
End with EXACTLY:
DM for credit or removal request.
I do not own the rights to this video.
All rights belong to their respective owners.

Return in EXACTLY this format:

━━━━━━━━━━━━━━━━━━
ON-SCREEN TEXT
━━━━━━━━━━━━━━━━━━
[on-screen text here]

━━━━━━━━━━━━━━━━━━
CAPTION
━━━━━━━━━━━━━━━━━━
[caption here]

DM for credit or removal request.
I do not own the rights to this video.
All rights belong to their respective owners.`;

function parseResponse(raw) {
  try {
    const onScreenMatch = raw.match(/ON-SCREEN TEXT\s*[━\-=]+\s*([\s\S]*?)(?:[━\-=]{3,}|CAPTION)/i);
    const captionMatch  = raw.match(/CAPTION\s*[━\-=]+\s*([\s\S]*?)$/i);
    return {
      onScreenText: onScreenMatch ? onScreenMatch[1].trim() : '',
      caption:      captionMatch  ? captionMatch[1].trim()  : raw.trim()
    };
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
    model: 'llama-3.3-70b-versatile',
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
