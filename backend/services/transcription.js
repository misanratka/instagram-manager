const Groq = require('groq-sdk');
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const logger = require('./logger');

function extractAudio(videoPath) {
  const audioPath = path.join(path.dirname(videoPath), `audio_${uuidv4()}.mp3`);
  return new Promise((resolve, reject) => {
    execFile('ffmpeg', [
      '-y', '-i', videoPath,
      '-vn', '-c:a', 'libmp3lame', '-b:a', '64k', '-ac', '1',
      audioPath
    ], { timeout: 120000 }, (err) => {
      if (err) reject(new Error(`Audio extraction failed: ${err.message}`));
      else resolve(audioPath);
    });
  });
}

async function transcribeVideo(videoPath) {
  if (!process.env.GROQ_API_KEY) {
    logger.warn('No GROQ_API_KEY set — skipping transcription');
    return { text: '', segments: [] };
  }

  logger.info(`Transcribing: ${path.basename(videoPath)}`);

  let audioPath = null;
  try {
    audioPath = await extractAudio(videoPath);

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    const result = await groq.audio.transcriptions.create({
      file: fs.createReadStream(audioPath),
      model: 'whisper-large-v3-turbo',
      response_format: 'verbose_json',
      timestamp_granularities: ['segment']
    });

    const segments = (result.segments || []).map(s => ({
      start: Number(s.start),
      end: Number(s.end),
      text: (s.text || '').trim()
    }));

    logger.info(`Transcription complete: ${(result.text || '').length} chars, ${segments.length} segments`);
    return { text: result.text || '', segments };
  } catch (err) {
    logger.error('Transcription failed:', err.message);
    return { text: '', segments: [] };
  } finally {
    if (audioPath && fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
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
