const Groq = require('groq-sdk');
const logger = require('./logger');

let groqClient;
function getClient() {
  if (!groqClient) groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return groqClient;
}

const STYLE_GUIDES = {
  casual:       'casual, friendly, relatable — like a popular entertainment page',
  professional: 'authoritative, polished, editorial — like a premium media outlet',
  funny:        'witty, humorous, meme-friendly — like a viral comedy page',
  motivational: 'inspiring, uplifting — like a cinematic fan page',
  minimal:      'ultra-short, punchy — under 15 words for the caption',
  educational:  'informative, storytelling-focused — like a culture/nostalgia page'
};

const SYSTEM_PROMPT = `You are an AI content engine for a professional viral Instagram entertainment page. Your job is to generate TWO completely separate outputs for every video.

OUTPUT 1 — ON-SCREEN TEXT:
- 1-2 lines maximum, punchy and readable on screen
- Describe the specific moment/action happening in this video
- If an original caption or title is provided, use it as reference and REWRITE it to be punchier — keep the core context, make it hit harder
- Celebrity name is OPTIONAL here — use it only if it fits naturally and makes the text punchier
- NEVER generic ("watch this", "omg", "wow") — always specific to THIS video
- NEVER @mentions

OUTPUT 2 — INSTAGRAM CAPTION (THIS IS THE MOST IMPORTANT OUTPUT):
- Written in PARAGRAPH STYLE — flowing prose, not bullet points or fragments
- RULE #1 — MANDATORY: If the video features ANY celebrity, public figure, athlete, musician, actor, creator, or well-known personality — you MUST use their FULL REAL NAME. NEVER say "the artist", "the player", "someone", "they" without first naming them. Their name must appear in the very first sentence of the caption.
- RULE #2 — CELEBRITY INTRODUCTION PARAGRAPH: Write a full paragraph introducing each celebrity — who they are, why the world knows them, their most famous work, achievements, records, cultural impact. Write this for someone who has NEVER heard of them before. If multiple celebrities appear, each gets their own paragraph.
- RULE #3 — VIDEO MOMENT PARAGRAPH: After introducing the celebrity/celebrities, write a separate paragraph describing exactly what is happening in THIS specific video — the moment, the scene, the performance, the reaction, the event, the achievement shown. Be specific: mention the event name, the song, the match, the show, the year if known.
- The caption should feel like a knowledgeable entertainment journalist wrote it for a premium page — informative, engaging, makes new fans want to follow
- NEVER references the on-screen text, "the hook", "the edit", or "the meme"
- NEVER includes @mentions or account handles
- NEVER copies original description word-for-word
- End ALWAYS with exactly these 3 lines:
  DM for credit or removal request.
  I do not own the rights to this video.
  All rights belong to their respective owners.

ALWAYS return in EXACTLY this format — no extra text, no explanations:

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

async function generateContent({ transcript, originalCaption, videoTitle, captionStyle, customPrompt }) {
  if (!process.env.GROQ_API_KEY) {
    return {
      caption: originalCaption || videoTitle || 'Check this out!\n\nDM for credit or removal request.\nI do not own the rights to this video.\nAll rights belong to their respective owners.',
      onScreenText: ''
    };
  }

  const style = customPrompt || STYLE_GUIDES[captionStyle] || STYLE_GUIDES.casual;
  const context = [
    videoTitle      && `Video title: ${videoTitle}`,
    originalCaption && `Original description: ${originalCaption.substring(0, 300)}`,
    transcript      && `Transcript: ${transcript.substring(0, 500)}`
  ].filter(Boolean).join('\n');

  logger.info(`Generating content (style: ${captionStyle})`);

  try {
    const completion = await getClient().chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: `${context}\n\nCaption style: ${style}\n\nGenerate the on-screen text and caption now:` }
      ],
      max_tokens: 1000,
      temperature: 0.95
    });
    return parseResponse(completion.choices[0].message.content);
  } catch (err) {
    logger.error('Content generation failed:', err.message);
    return {
      caption: originalCaption || videoTitle || '',
      onScreenText: ''
    };
  }
}

// Keep for backward compatibility
async function generateCaption(opts) {
  const { caption } = await generateContent(opts);
  return caption;
}

async function generateSubtitleLines({ transcript, segments }) {
  if (!transcript && (!segments || segments.length === 0)) return [];
  return segments || [];
}

module.exports = { generateContent, generateCaption, generateSubtitleLines };
