const { GoogleGenerativeAI } = require('@google/generative-ai');
const logger = require('./logger');

let genAI;
function getClient() {
  if (!genAI) genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return genAI;
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
  if (!process.env.GEMINI_API_KEY) {
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
    const model = getClient().getGenerativeModel({
      model: 'gemini-2.0-flash',
      systemInstruction: 'You are an expert Instagram content creator. Write captions optimized for engagement and reach. Max 2200 characters.'
    });
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: `${context}\n\nStyle: ${styleGuide}\n\nWrite the caption:` }] }],
      generationConfig: { maxOutputTokens: 400, temperature: 0.85 }
    });
    return result.response.text().trim();
  } catch (err) {
    logger.error('Caption generation failed:', err.message);
    return originalCaption || videoTitle || '';
  }
}

async function generateHookText({ transcript, videoTitle }) {
  if (!process.env.GEMINI_API_KEY) return '';

  try {
    const model = getClient().getGenerativeModel({
      model: 'gemini-2.0-flash',
      systemInstruction: 'You create short hook text overlays for viral Instagram Reels. The hook appears in the first 3 seconds. Keep it under 8 words. Make it curiosity-driven or bold.'
    });
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: `Video: "${videoTitle}"\nTranscript: "${(transcript || '').substring(0, 300)}"\n\nWrite ONE short hook text (under 8 words):` }] }],
      generationConfig: { maxOutputTokens: 30, temperature: 0.9 }
    });
    return result.response.text().trim().replace(/^["']|["']$/g, '');
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
  if (!process.env.GEMINI_API_KEY) return [];

  try {
    const model = getClient().getGenerativeModel({
      model: 'gemini-2.0-flash',
      systemInstruction: 'Return a JSON object with key "texts" containing an array of 2-4 short on-screen text overlays (max 8 words each) suitable for a Reel video.'
    });
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: `Video: "${videoTitle}"\nTranscript: "${(transcript || '').substring(0, 400)}"` }] }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 120, temperature: 0.8 }
    });
    const parsed = JSON.parse(result.response.text());
    return Array.isArray(parsed.texts) ? parsed.texts : [];
  } catch (err) {
    logger.error('On-screen suggestions failed:', err.message);
    return [];
  }
}

module.exports = { generateCaption, generateHookText, generateSubtitleLines, generateOnScreenSuggestions };
