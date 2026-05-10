const { GoogleGenerativeAI } = require('@google/generative-ai');
const { GoogleAIFileManager } = require('@google/generative-ai/server');
const path = require('path');
const logger = require('./logger');

const MIME_TYPES = {
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
  '.mkv': 'video/x-matroska', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg'
};

async function transcribeVideo(videoPath) {
  if (!process.env.GEMINI_API_KEY) {
    logger.warn('No GEMINI_API_KEY set — skipping transcription');
    return { text: '', segments: [] };
  }

  logger.info(`Transcribing: ${path.basename(videoPath)}`);

  const mimeType = MIME_TYPES[path.extname(videoPath).toLowerCase()] || 'video/mp4';
  const fileManager = new GoogleAIFileManager(process.env.GEMINI_API_KEY);
  let uploadedFile;

  try {
    const upload = await fileManager.uploadFile(videoPath, {
      mimeType,
      displayName: path.basename(videoPath)
    });
    uploadedFile = upload.file;

    // Wait for file to finish processing
    while (uploadedFile.state === 'PROCESSING') {
      await new Promise(r => setTimeout(r, 2000));
      uploadedFile = await fileManager.getFile(uploadedFile.name);
    }
    if (uploadedFile.state !== 'ACTIVE') {
      throw new Error(`File processing failed with state: ${uploadedFile.state}`);
    }

    const model = new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
      .getGenerativeModel({ model: 'gemini-2.0-flash' });

    const result = await model.generateContent({
      contents: [{
        role: 'user',
        parts: [
          { fileData: { mimeType: uploadedFile.mimeType, fileUri: uploadedFile.uri } },
          { text: 'Transcribe all speech in this video. Return ONLY valid JSON with no markdown fences: {"text":"full transcript","segments":[{"start":0.0,"end":3.0,"text":"spoken words"}]}. Use approximate timestamps in seconds. Each segment should be 3-8 seconds long.' }
        ]
      }],
      generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 2048 }
    });

    const raw = result.response.text().trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    const parsed = JSON.parse(raw);
    const segments = (parsed.segments || []).map(s => ({
      start: Number(s.start),
      end: Number(s.end),
      text: (s.text || '').trim()
    }));

    logger.info(`Transcription complete: ${(parsed.text || '').length} chars, ${segments.length} segments`);
    return { text: parsed.text || '', segments };
  } catch (err) {
    logger.error('Transcription failed:', err.message);
    return { text: '', segments: [] };
  } finally {
    if (uploadedFile) fileManager.deleteFile(uploadedFile.name).catch(() => {});
  }
}

function segmentsToSRT(segments) {
  if (!segments || segments.length === 0) return '';

  function toSRTTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.round((seconds % 1) * 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  }

  return segments
    .map((seg, i) => `${i + 1}\n${toSRTTime(seg.start)} --> ${toSRTTime(seg.end)}\n${seg.text}`)
    .join('\n\n');
}

module.exports = { transcribeVideo, segmentsToSRT };
