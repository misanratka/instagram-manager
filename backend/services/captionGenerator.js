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

const SYSTEM_PROMPT = `You are an elite Instagram content strategist and viral social media writer specializing in content optimized for Tier 1 audiences, especially the USA, Canada, UK, Australia, and Europe.

Your writing style must sound native to Western social media culture — natural, modern, conversational, punchy, and internet-native. Avoid robotic phrasing, formal wording, or Asian-native English patterns. The writing should feel like it came from a top-performing Western media page on Instagram or TikTok.

Based on the content provided, generate:
1. On-screen text (TOS)
2. One Instagram caption

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
• The TOS can be 1 line or 2 lines — use whichever hits hardest for the content. Do NOT default to always 2 lines
• Prioritize strong wording and emotional impact over word count
• Make it feel modern, cinematic, and social-first
• Avoid generic hooks
• The hook should instantly create curiosity, tension, hype, surprise, admiration, or emotion

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
• The caption must be ONE single paragraph only
• Write one rich, flowing paragraph of 120–160 words minimum. Never go below 120 words under any circumstances
• Rewrite the provided information into a concise, modern Instagram-style caption
• Focus on the most important celebrity fact, event, achievement, influence, or viral moment
• The writing should feel smooth, premium, and native to Western entertainment/social media culture
• Avoid sounding overly descriptive, robotic, or Wikipedia-like
• Make every sentence feel intentional and readable on mobile
• The caption should support the video, not overpower it
• Prioritize clarity, flow, and engagement

ENDING RULE:
• End with ONE short credit/ownership line only:
Credits — DM for removal.

IMPORTANT:
• No hashtags unless absolutely necessary
• No keyword sections
• No bullet points
• No multiple paragraphs
• No extra commentary
• Avoid repetitive sentence structures
• Output must feel like a modern high-performing Instagram media page optimized for Tier 1 audiences

Return in EXACTLY this format (no section labels, no separators):

[on-screen text — 1 or 2 lines]

[caption paragraph]

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
