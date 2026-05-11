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
- A short, punchy video overlay (1-2 lines max)
- Viral, meme-style, copy-friendly — suitable for CapCut, Premiere, Final Cut
- Think: relatable hook, funny observation, dramatic quote, or bold statement
- NEVER a full sentence explaining the video
- NEVER @mentions
- This is a visual asset, not part of the caption

OUTPUT 2 — INSTAGRAM CAPTION:
- Written in PARAGRAPH STYLE — flowing prose, not bullet points or fragments
- If the video features ANY celebrity, public figure, athlete, musician, actor, influencer, or well-known personality, you MUST:
  • Identify them by their FULL REAL NAME (e.g. "Cristiano Ronaldo", "Dua Lipa", "LeBron James")
  • Write a dedicated paragraph about who they are, what they are famous for, their biggest achievements, and why people love them
  • Be specific and detailed — mention albums, movies, championships, records, or cultural impact
  • If multiple celebrities appear, write a separate paragraph for each one
- After the celebrity paragraph(s), write about the specific moment/scene/performance in the video
- The caption must feel like it was written by a knowledgeable entertainment journalist, not a generic bot
- NEVER say "the person in the video" or "someone" — always use real names if you can identify them
- NEVER references the on-screen text, "the hook", "the edit", or "the meme"
- NEVER includes @mentions or account handles
- NEVER copies original description word-for-word
- Must make complete sense even if the on-screen text is never seen
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
