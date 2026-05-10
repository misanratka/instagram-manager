const Groq = require('groq-sdk');
const logger = require('./logger');

let groqClient;
function getClient() {
  if (!groqClient) groqClient = new Groq({ apiKey: process.env.GROQ_API_KEY });
  return groqClient;
}

const STYLE_GUIDES = {
  casual:       'Write a casual, friendly Instagram caption with 2-3 relevant hashtags. Sound natural, like a real person.',
  professional: 'Write a professional, authoritative Instagram caption with industry-relevant hashtags.',
  funny:        'Write a witty, humorous Instagram caption with trending hashtags. Make it entertaining.',
  motivational: 'Write an inspiring, motivational Instagram caption with uplifting hashtags.',
  minimal:      'Write a short, punchy Instagram caption — under 15 words — with 1-2 hashtags only.',
  educational:  'Write an educational Instagram caption that provides value, with niche hashtags.'
};

async function generateCaption({ transcript, originalCaption, videoTitle, captionStyle, customPrompt }) {
  if (!process.env.GROQ_API_KEY) {
    return originalCaption || videoTitle || 'Check this out! #reels #instagram';
  }

  const styleGuide = customPrompt || STYLE_GUIDES[captionStyle] || STYLE_GUIDES.casual;
  const context = [
    videoTitle      && `Video title: ${videoTitle}`,
    originalCaption && `Original description: ${originalCaption.substring(0, 300)}`,
    transcript      && `Transcript: ${transcript.substring(0, 500)}`
  ].filter(Boolean).join('\n');

  logger.info(`Generating caption (style: ${captionStyle})`);

  try {
    const completion = await getClient().chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: 'You are an expert Instagram content creator. NEVER copy the original caption word for word. Always write a COMPLETELY NEW caption using different words, fresh angles, and your own creative voice. NEVER include any @mentions, account handles, or tag any accounts. Optimize for engagement and reach. Max 2200 characters.'
        },
        {
          role: 'user',
          content: `${context}\n\nStyle: ${styleGuide}\n\nWrite a COMPLETELY NEW and ORIGINAL caption (do NOT copy the original description — rewrite it entirely with fresh words and a new angle):`
        }
      ],
      max_tokens: 400,
      temperature: 0.95
    });
    return completion.choices[0].message.content.trim();
  } catch (err) {
    logger.error('Caption generation failed:', err.message);
    return originalCaption || videoTitle || '';
  }
}

async function generateHookText({ transcript, videoTitle }) {
  if (!process.env.GROQ_API_KEY) return '';

  try {
    const completion = await getClient().chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: 'You create short hook text overlays for viral Instagram Reels. The hook appears in the first 3 seconds. Keep it under 8 words. Make it curiosity-driven or bold.'
        },
        {
          role: 'user',
          content: `Video: "${videoTitle}"\nTranscript: "${(transcript || '').substring(0, 300)}"\n\nWrite ONE short hook text (under 8 words):`
        }
      ],
      max_tokens: 30,
      temperature: 0.9
    });
    return completion.choices[0].message.content.trim().replace(/^["']|["']$/g, '');
  } catch (err) {
    logger.error('Hook text generation failed:', err.message);
    return '';
  }
}

async function generateSubtitleLines({ transcript, segments }) {
  if (!transcript && (!segments || segments.length === 0)) return [];
  return segments || [];
}

async function generateOnScreenSuggestions({ transcript, videoTitle }) {
  if (!process.env.GROQ_API_KEY) return [];

  try {
    const completion = await getClient().chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: 'Return a JSON object with key "texts" containing an array of 2-4 short on-screen text overlays (max 8 words each) suitable for a Reel video. Return ONLY valid JSON, no markdown.'
        },
        {
          role: 'user',
          content: `Video: "${videoTitle}"\nTranscript: "${(transcript || '').substring(0, 400)}"`
        }
      ],
      max_tokens: 120,
      temperature: 0.8,
      response_format: { type: 'json_object' }
    });
    const parsed = JSON.parse(completion.choices[0].message.content);
    return Array.isArray(parsed.texts) ? parsed.texts : [];
  } catch (err) {
    logger.error('On-screen suggestions failed:', err.message);
    return [];
  }
}

module.exports = { generateCaption, generateHookText, generateSubtitleLines, generateOnScreenSuggestions };
