import React, { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';
import TextOverlayEditor from './TextOverlayEditor';

const STEPS = { INPUT: 'input', PROCESSING: 'processing', REVIEW: 'review' };

const SPEEDS = [
  { label: '0.5×',  value: 0.5 },
  { label: '0.75×', value: 0.75 },
  { label: '1×',    value: 1 },
  { label: '1.5×',  value: 1.5 },
  { label: '2×',    value: 2 },
];

const CROP_RATIOS = [
  { label: 'Original', value: 'none' },
  { label: '9:16',     value: '9/16', desc: 'Reels / Stories' },
  { label: '4:5',      value: '4/5',  desc: 'Feed Portrait' },
  { label: '1:1',      value: '1/1',  desc: 'Square' },
  { label: '16:9',     value: '16/9', desc: 'Landscape' },
];

function getBackgroundFill(bg) {
  if (bg === 'black') return '#000000';
  if (bg === 'white') return '#ffffff';
  if (bg === 'dark')  return 'rgba(0,0,0,0.78)';
  if (bg === 'light') return 'rgba(255,255,255,0.82)';
  return 'transparent';
}

function getBoxTextColor(box) {
  if (box.bg === 'black' || box.bg === 'dark') return '#fff';
  if (box.bg === 'white' || box.bg === 'light') return '#111';
  return box.colorHex || '#fff';
}

// Main component ────────────────────────────────────────────────────────────
export default function NewPost() {
  const [accounts, setAccounts]         = useState([]);
  const [accountId, setAccountId]       = useState('');
  const [url, setUrl]                   = useState('');
  const [file, setFile]                 = useState(null);
  const [step, setStep]                 = useState(STEPS.INPUT);
  const [result, setResult]             = useState(null);
  const [caption, setCaption]           = useState('');
  const [onScreenText, setOnScreenText] = useState('');
  const [textBoxes, setTextBoxes]       = useState([]);
  const [enhancedUrl, setEnhancedUrl]   = useState(null);
  const [showTextEditor, setShowTextEditor] = useState(false);
  const [segments, setSegments]         = useState([]);
  const [subtitleStyle, setSubtitleStyle] = useState('standard');
  const [burnSubs, setBurnSubs]         = useState(false);
  const [enhance, setEnhance]           = useState(false);
  const [enhancing, setEnhancing]       = useState(false);
  const [trimStart, setTrimStart]   = useState('');
  const [trimEnd, setTrimEnd]       = useState('');
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast]     = useState(1);
  const [saturation, setSaturation] = useState(1);
  const [speed, setSpeed]           = useState(1);
  const [cropRatio, setCropRatio]   = useState('none');
  const [scheduling, setScheduling]     = useState(false);
  const [scheduleTime, setScheduleTime] = useState('');
  const [posting, setPosting]           = useState(false);
  const [error, setError]               = useState('');
  const [success, setSuccess]           = useState('');
  const [popup, setPopup]               = useState(null);
  const fileRef = useRef();
  const PUBLISH_STATUS_POLL_MS = 3000;
  const PUBLISH_STATUS_TIMEOUT_MS = 90000;

  function showPopup(type, detail) { setPopup({ type, detail }); }
  function closePopup() { setPopup(null); reset(); }

  useEffect(() => { api.getAccounts().then(setAccounts).catch(() => {}); }, []);

  function reset() {
    setStep(STEPS.INPUT); setResult(null); setCaption('');
    setOnScreenText(''); setTextBoxes([]); setEnhancedUrl(null);
    setBurnSubs(false); setEnhance(false);
    setTrimStart(''); setTrimEnd('');
    setBrightness(0); setContrast(1); setSaturation(1); setSpeed(1);
    setCropRatio('none');
    setScheduling(false); setScheduleTime('');
    setError(''); setSuccess(''); setUrl(''); setFile(null);
  }

  async function handleProcess() {
    if (!url.trim() && !file) return setError('Enter a video URL or upload a file');
    setError(''); setStep(STEPS.PROCESSING);
    try {
      const data = file
        ? await api.processFile(file, accountId || null)
        : await api.processUrl(url.trim(), accountId || null);
      setResult(data);
      setCaption(data.generatedCaption || '');
      setOnScreenText(data.hookText || '');
      setSegments(data.segments || []);
      setStep(STEPS.REVIEW);
    } catch (err) {
      setError(err.message);
      setStep(STEPS.INPUT);
    }
  }

  async function handleEnhance() {
    const hasText  = textBoxes.some(b => b.text);
    const hasTrim  = Number(trimStart) > 0 || Number(trimEnd) > 0;
    const hasAdj   = brightness !== 0 || contrast !== 1 || saturation !== 1;
    const hasSpeed = speed !== 1;
    const hasCrop  = cropRatio !== 'none';
    if (!burnSubs && !enhance && !hasText && !hasTrim && !hasAdj && !hasSpeed && !hasCrop)
      return setError('Make at least one edit or enable an enhancement');
    setError(''); setEnhancing(true);
    try {
      await api.updateCaption(result.postId, { caption, hookText: '' });
      const res = await api.enhanceVideo(result.postId, {
        burnSubtitles: burnSubs,
        subtitleStyle,
        segments,
        enhance,
        textOverlays:  textBoxes.filter(b => b.text || b.bg !== 'none'),
        trim:          { start: Number(trimStart) || 0, end: Number(trimEnd) || 0 },
        adjustments:   { brightness, contrast, saturation },
        speed,
        cropRatio
      });
      setEnhancedUrl(res.enhancedVideoUrl);
    } catch (err) {
      setError(err.message);
    } finally {
      setEnhancing(false);
    }
  }

  async function handlePublish() {
    if (!accountId) return setError('Select an Instagram account first');
    setPosting(true); setError(''); setSuccess('');
    try {
      await api.updateCaption(result.postId, { caption, hookText: '' });
      await api.publishPost(result.postId, { account_id: accountId, caption });
      setSuccess('Publishing to Instagram. Waiting for final status…');

      const startedAt = Date.now();
      while (Date.now() - startedAt < PUBLISH_STATUS_TIMEOUT_MS) {
        await new Promise(resolve => setTimeout(resolve, PUBLISH_STATUS_POLL_MS));
        const posts = await api.getPosts().catch(() => []);
        const latest = posts.find(p => p.id === result.postId);

        if (!latest) continue;
        if (latest.status === 'failed') {
          setSuccess('');
          setError(latest.error_message || 'Instagram publishing failed.');
          setPosting(false);
          return;
        }
        if (latest.status === 'posted') {
          setSuccess('');
          showPopup('posted');
          return;
        }
      }

      setSuccess('');
      showPopup('posted', 'Your reel is still processing. If Instagram rejects it, the exact reason will appear in Posts.');
    } catch (err) {
      setError(err.message);
    } finally {
      setPosting(false);
    }
  }

  async function handleSchedule() {
    if (!accountId) return setError('Select an Instagram account first');
    if (!scheduleTime) return setError('Pick a date and time');
    setPosting(true); setError('');
    try {
      await api.updateCaption(result.postId, { caption, hookText: '' });
      await api.schedulePost(result.postId, {
        scheduled_at: new Date(scheduleTime).toISOString(),
        account_id: accountId, caption
      });
      showPopup('scheduled', new Date(scheduleTime).toLocaleString());
    } catch (err) {
      setError(err.message);
      setPosting(false);
    }
  }

  function onDrop(e) {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f && f.type.startsWith('video/')) { setFile(f); setUrl(''); }
  }

  const minTime      = new Date(Date.now() + 5 * 60000).toISOString().slice(0, 16);
  const previewUrl   = enhancedUrl || result?.videoUrl;
  const isIgCaption  = !!(result?.instagramUrl && !result?.videoUrl);

  if (popup) {
    const isPosted = popup.type === 'posted';
    return (
      <div style={s.center}>
        <div style={popupStyle.box}>
          <div style={popupStyle.icon}>{isPosted ? '🎉' : '🕐'}</div>
          <div style={popupStyle.title}>{isPosted ? 'Reel Submitted!' : 'Reel Scheduled!'}</div>
          <div style={popupStyle.desc}>
            {isPosted
              ? (popup.detail || 'Your reel is being published to Instagram.\nCheck the Posts tab to see when it goes live.')
              : `Your reel is scheduled for\n${popup.detail}`}
          </div>
          <button onClick={closePopup} style={popupStyle.btn}>{isPosted ? 'Post Another' : 'Done'}</button>
        </div>
      </div>
    );
  }

  if (step === STEPS.PROCESSING) {
    return (
      <div style={s.center}>
        <div style={s.spinner} />
        <div style={s.processingTitle}>Processing video…</div>
        <div style={s.hint}>Downloading video and rewriting caption with AI. This may take a moment.</div>
      </div>
    );
  }

  if (step === STEPS.REVIEW && result) {
    return (
      <div>
        <div style={s.reviewHeader}>
          <h2 style={s.h2}>Review & Post</h2>
          <button onClick={reset} style={s.ghostBtn}>✕ Start over</button>
        </div>

        {error   && <div style={s.errorBox}>{error}</div>}
        {success && <div style={s.successBox}>{success}</div>}

        <div style={s.onScreenBox}>
          <div style={s.onScreenHeader}>
            <span style={s.onScreenLabel}>ON-SCREEN TEXT (for CapCut / Premiere)</span>
            <button onClick={() => navigator.clipboard.writeText(onScreenText)} style={s.copyBtn}>Copy</button>
          </div>
          <textarea
            id="on-screen-text"
            name="on_screen_text"
            value={onScreenText}
            onChange={e => setOnScreenText(e.target.value)}
            rows={2}
            placeholder="Add on-screen text…"
            style={{ ...s.textarea, fontSize: 16, fontWeight: 600, lineHeight: 1.5, background: 'transparent', border: '1px solid #2a2a4a', color: '#fff', resize: 'vertical' }}
          />
        </div>

        {isIgCaption && (
          <Section label="Video">
            <div style={s.igNotice}>
              <div style={{ fontSize: 13, color: '#aaa', marginBottom: 10 }}>
                Caption rewritten from the original Instagram post. Upload the video file below to post it.
              </div>
              <IgVideoUpload postId={result.postId} onUploaded={url => setResult(r => ({ ...r, videoUrl: url, instagramUrl: null }))} />
            </div>
          </Section>
        )}

        {!isIgCaption && (
          <>
            <Section label="Video">
              <div style={{ position: 'relative', background: '#000', borderRadius: 8, overflow: 'hidden' }}>
                {previewUrl
                  ? <video src={previewUrl} controls style={{ width: '100%', display: 'block', maxHeight: 380, filter: `brightness(${1 + brightness}) contrast(${contrast}) saturate(${saturation})` }} />
                  : <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333', fontSize: 13 }}>No video preview</div>
                }
                {textBoxes.map(box => {
                  const isCover = !box.text.trim() && box.bg !== 'none';
                  const isBlack = box.bg === 'black' || box.bg === 'dark';
                  const isWhite = box.bg === 'white' || box.bg === 'light';
                  if (isCover) {
                    return (
                      <div key={box.id} style={{
                        position: 'absolute', left: `${box.xPct}%`, top: `${box.yPct}%`,
                        transform: 'translate(-50%,-50%)',
                        width: `${box.coverWidthPct || 65}%`, height: `${box.coverHeightPct || 14}%`,
                        minWidth: 20, minHeight: 8,
                        background: getBackgroundFill(box.bg),
                        pointerEvents: 'none', borderRadius: 4,
                      }} />
                    );
                  }
                  const sizePx = (box.fontSize || 28) * 0.65;
                  return (
                    <div key={box.id} style={{
                      position: 'absolute', left: `${box.xPct}%`, top: `${box.yPct}%`,
                      transform: 'translate(-50%,-50%)', fontSize: sizePx, fontWeight: 'bold',
                      fontFamily: 'sans-serif', pointerEvents: 'none', borderRadius: 8, padding: '4px 8px',
                      width: `${Math.max(18, (box.widthPct || 80) * 0.78)}%`,
                      background: box.bg === 'none' ? 'transparent' : getBackgroundFill(box.bg),
                      color: getBoxTextColor(box),
                      textShadow: (!isBlack && !isWhite) ? '1px 1px 3px rgba(0,0,0,1)' : 'none',
                      whiteSpace: 'pre-wrap', textAlign: box.align || 'center', lineHeight: 1.18,
                    }}>
                      {box.text}
                    </div>
                  );
                })}
              </div>
              <button onClick={() => setShowTextEditor(true)} style={{ marginTop: 8, padding: '9px 18px', background: '#111', border: '1px solid #3a3a6a', borderRadius: 8, color: '#7b6fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, display: 'block', width: '100%', textAlign: 'center' }}>
                ✏ Edit Text on Video {textBoxes.length > 0 ? `(${textBoxes.length} text${textBoxes.length > 1 ? 's' : ''})` : ''}
              </button>
              {enhancedUrl && <div style={s.badge}>✓ Rendered</div>}
            </Section>


            <Section label="Adjustments">
              <div style={s.editGrid}>
                <div>
                  <div style={s.editLabel}>Trim (seconds)</div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 3, flex: 1 }}>
                      <input id="trim-start" name="trim_start" type="number" min="0" placeholder="0" value={trimStart} onChange={e => setTrimStart(e.target.value)} style={{ ...s.timeInput, flex: 1, minWidth: 0 }} />
                      <span style={{ color: '#555', fontSize: 11 }}>s</span>
                    </div>
                    <span style={{ color: '#383838' }}>—</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 3, flex: 1 }}>
                      <input id="trim-end" name="trim_end" type="number" min="0" placeholder="end" value={trimEnd} onChange={e => setTrimEnd(e.target.value)} style={{ ...s.timeInput, flex: 1, minWidth: 0 }} />
                      <span style={{ color: '#555', fontSize: 11 }}>s</span>
                    </div>
                  </div>
                </div>
                <div>
              <SliderRow label="Brightness" value={brightness} min={-0.5} max={0.5}  step={0.05} def={0} onChange={setBrightness} format={v => (v >= 0 ? '+' : '') + Math.round(v * 100) + '%'} />
              <SliderRow label="Contrast"   value={contrast}   min={0.5}  max={2.0}  step={0.05} def={1} onChange={setContrast}   format={v => v.toFixed(1) + '×'} />
              <SliderRow label="Saturation" value={saturation} min={0}    max={2.0}  step={0.05} def={1} onChange={setSaturation} format={v => v.toFixed(1) + '×'} />
            </Section>

            <Section label="Quality">
              <div style={s.toggleRow}>
                <Toggle on={burnSubs} onChange={setBurnSubs} label="Burn Subtitles" desc="Embed transcript captions into video" disabled={!result.srtContent} />
                {burnSubs && result.srtContent && (
                  <div style={{ marginLeft: 50, marginTop: 4, marginBottom: 8 }}>
                    <div style={{ fontSize: 11, color: '#555', marginBottom: 6 }}>SUBTITLE STYLE</div>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {[
                        { v: 'standard',   label: 'Standard',        desc: 'White bold text' },
                        { v: '3d-caps',    label: '3D ALL CAPS',     desc: 'Yellow Impact, 3D shadow' },
                        { v: 'word-color', label: 'Color Word Beat', desc: 'One word at a time, colorful' },
                        { v: 'word-clean', label: 'Word Beat',       desc: 'One word at a time, clean' },
                      ].map(st => (
                        <button key={st.v} onClick={() => setSubtitleStyle(st.v)} style={{
                          padding: '6px 12px', borderRadius: 7, cursor: 'pointer', fontSize: 11, fontWeight: 700, textAlign: 'left',
                          background: subtitleStyle === st.v ? '#1a1a3a' : '#111',
                          border: subtitleStyle === st.v ? '1.5px solid #7b6fff' : '1px solid #2a2a2a',
                          color: subtitleStyle === st.v ? '#7b6fff' : '#666',
                        }}>
                          <div>{st.label}</div>
                          <div style={{ fontWeight: 400, fontSize: 10, opacity: 0.7 }}>{st.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <Toggle on={enhance} onChange={setEnhance} label="Boost Quality" desc="Sharpen + enhance brightness, contrast & color" />
              </div>
            </Section>

            <button
              onClick={handleEnhance}
              disabled={enhancing}
              style={{ ...s.btn, ...s.btnSecondary, marginBottom: 20, opacity: enhancing ? 0.5 : 1 }}
            >
              {enhancing ? <><span style={s.miniSpinner} /> Rendering…</> : 'Apply Edits & Render Video'}
            </button>
          </>
        )}

        <Section label="Caption">
          <textarea id="caption" name="caption" value={caption} onChange={e => setCaption(e.target.value)} rows={5} style={s.textarea} placeholder="Edit your caption…" />
          <div style={s.charCount}>{caption.length} / 2200</div>
        </Section>

        <Section label="Post to Instagram Account">
          <select id="account-select-review" name="account_id" value={accountId} onChange={e => setAccountId(e.target.value)} style={s.select}>
            <option value="">Select account…</option>
            {accounts.map(a => <option key={a.id} value={a.id}>@{a.username} — {a.name}</option>)}
          </select>
          {accounts.length === 0 && <div style={s.hint}>No accounts yet — go to the Accounts tab and click "Connect Instagram".</div>}
        </Section>

        <div style={s.actions}>
          <button onClick={handlePublish} disabled={posting || !accountId} style={{ ...s.btn, ...s.btnPrimary, opacity: posting || !accountId ? 0.4 : 1 }}>
            {posting ? <><span style={s.miniSpinner} /> Posting…</> : '🚀 Post Now'}
          </button>
          <button onClick={() => setScheduling(v => !v)} style={{ ...s.btn, ...s.btnSecondary }}>
            {scheduling ? 'Cancel' : '🕐 Schedule'}
          </button>
        </div>

        {scheduling && (
          <div style={s.scheduleBox}>
            <div style={s.label}>Pick date & time</div>
            <input id="schedule-time" name="schedule_time" type="datetime-local" min={minTime} value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} style={s.input} />
            <button
              onClick={handleSchedule}
              disabled={!scheduleTime || posting || !accountId}
              style={{ ...s.btn, ...s.btnPrimary, marginTop: 10, opacity: !scheduleTime || posting || !accountId ? 0.4 : 1 }}
            >
              {posting ? 'Scheduling…' : 'Confirm Schedule'}
            </button>
          </div>
        )}

        {showTextEditor && (
          <TextOverlayEditor
            videoSrc={previewUrl}
            textBoxes={textBoxes}
            onChange={setTextBoxes}
            onClose={() => setShowTextEditor(false)}
          />
        )}
      </div>
    );
  }

  return (
    <div>
      <h2 style={s.h2}>New Post</h2>
      {error && <div style={s.errorBox}>{error}</div>}

      <Section label="Account (optional)">
        <select id="account-select" name="account_id" value={accountId} onChange={e => setAccountId(e.target.value)} style={s.select}>
          <option value="">No account selected</option>
          {accounts.map(a => <option key={a.id} value={a.id}>@{a.username} — {a.name}</option>)}
        </select>
      </Section>

      <Section label="Video">
        <div style={s.dropZone} onDrop={onDrop} onDragOver={e => e.preventDefault()} onClick={() => !file && fileRef.current?.click()}>
          {file ? (
            <div style={s.fileRow}>
              <span style={{ color: '#ccc' }}>📹 {file.name}</span>
              <button onClick={e => { e.stopPropagation(); setFile(null); }} style={s.clearBtn}>✕</button>
            </div>
          ) : (
            <>
              <div style={s.dropIcon}>⬆</div>
              <div style={{ color: '#555' }}>Drop video here or <span style={{ color: '#833ab4', cursor: 'pointer' }}>browse</span></div>
              <div style={s.hint}>MP4 / MOV / AVI up to 200 MB</div>
            </>
          )}
        </div>
        <input id="video-file" name="video_file" ref={fileRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={e => { setFile(e.target.files[0]); setUrl(''); }} />

        {!file && (
          <>
            <div style={s.orDivider}>or paste a link</div>
            <input
              id="video-url"
              name="video_url"
              type="text" value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleProcess()}
              placeholder="Instagram Reel, YouTube, TikTok URL…"
              style={s.input}
            />
          </>
        )}
      </Section>

      <button onClick={handleProcess} disabled={!url.trim() && !file} style={{ ...s.btn, ...s.btnPrimary, opacity: !url.trim() && !file ? 0.4 : 1 }}>
        Process Video →
      </button>
    </div>
  );
}

function IgVideoUpload({ postId, onUploaded }) {
  const [uploading, setUploading] = useState(false);
  const [err, setErr]             = useState('');
  const ref = useRef();

  async function handleFile(file) {
    if (!file || !file.type.startsWith('video/')) return setErr('Please select a video file');
    setErr(''); setUploading(true);
    try {
      const data = await api.attachVideo(postId, file);
      onUploaded(data.videoUrl);
    } catch (e) {
      setErr(e.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      {err && <div style={{ color: '#ff7070', fontSize: 12, marginBottom: 8 }}>{err}</div>}
      <div
        style={{ border: '2px dashed #333', borderRadius: 10, padding: '28px 20px', textAlign: 'center', cursor: 'pointer' }}
        onClick={() => ref.current?.click()}
        onDrop={e => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
        onDragOver={e => e.preventDefault()}
      >
        {uploading
          ? <><span style={s.miniSpinner} /> Uploading…</>
          : <><div style={{ fontSize: 24, marginBottom: 6 }}>📁</div><div style={{ color: '#666', fontSize: 13 }}>Tap to upload the video file</div></>
        }
      </div>
      <input id="ig-video-file" name="ig_video_file" ref={ref} type="file" accept="video/*" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
    </div>
  );
}

function Section({ label, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 8 }}>{label}</div>
      {children}
    </div>
  );
}

function SliderRow({ label, value, min, max, step, def, onChange, format }) {
  const display = format ? format(value) : Number(value).toFixed(2);
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontSize: 12, color: '#888' }}>{label}</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#ccc', minWidth: 36, textAlign: 'right' }}>{display}</span>
          {value !== def && (
            <button onClick={() => onChange(def)} style={{ fontSize: 10, color: '#555', background: 'none', border: '1px solid #333', borderRadius: 4, padding: '1px 5px', cursor: 'pointer' }}>reset</button>
          )}
        </div>
      </div>
      <input id={`slider-${label.toLowerCase().replace(/\s+/g,'-')}`} name={label.toLowerCase().replace(/\s+/g,'_')} type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} style={{ width: '100%', accentColor: '#833ab4', cursor: 'pointer' }} />
    </div>
  );
}

function Toggle({ on, onChange, label, desc, disabled }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
      <button onClick={() => !disabled && onChange(!on)} disabled={disabled} style={{
        width: 40, height: 22, borderRadius: 11, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
        background: on ? 'linear-gradient(135deg,#833ab4,#fd1d1d)' : '#2a2a2a',
        position: 'relative', flexShrink: 0, transition: 'background .2s', opacity: disabled ? 0.3 : 1
      }}>
        <span style={{ position: 'absolute', top: 3, left: on ? 21 : 3, width: 16, height: 16, background: '#fff', borderRadius: '50%', transition: 'left .2s' }} />
      </button>
      <div>
        <div style={{ fontSize: 13, color: '#ccc', fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 11, color: '#555', marginTop: 1 }}>{desc}</div>
      </div>
    </div>
  );
}

const s = {
  h2:             { fontSize: 22, fontWeight: 700, marginBottom: 24, color: '#fff' },
  label:          { fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 8 },
  editLabel:      { fontSize: 11, fontWeight: 600, color: '#666', marginBottom: 6 },
  input:          { width: '100%', padding: '10px 12px', background: '#111', border: '1px solid #252525', borderRadius: 8, color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box' },
  select:         { width: '100%', padding: '10px 12px', background: '#111', border: '1px solid #252525', borderRadius: 8, color: '#fff', fontSize: 14, outline: 'none', cursor: 'pointer' },
  textarea:       { width: '100%', padding: '10px 12px', background: '#111', border: '1px solid #252525', borderRadius: 8, color: '#fff', fontSize: 14, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6, outline: 'none' },
  charCount:      { textAlign: 'right', fontSize: 11, color: '#333', marginTop: 4 },
  timeInput:      { padding: '8px 10px', background: '#111', border: '1px solid #252525', borderRadius: 6, color: '#ccc', fontSize: 13, outline: 'none' },
  dropZone:       { border: '2px dashed #252525', borderRadius: 10, padding: '36px 24px', textAlign: 'center', cursor: 'pointer', marginBottom: 12 },
  dropIcon:       { fontSize: 28, marginBottom: 8, color: '#444' },
  fileRow:        { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  orDivider:      { textAlign: 'center', color: '#333', fontSize: 12, margin: '10px 0' },
  hint:           { fontSize: 11, color: '#444', marginTop: 5 },
  btn:            { padding: '11px 22px', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', border: 'none', display: 'inline-flex', alignItems: 'center', gap: 8 },
  btnPrimary:     { background: 'linear-gradient(135deg,#833ab4,#fd1d1d)', color: '#fff' },
  btnSecondary:   { background: '#1a1a1a', border: '1px solid #333', color: '#ccc' },
  cropBtn:        { padding: '8px 14px', borderRadius: 8, cursor: 'pointer', transition: 'all .15s', minWidth: 64, textAlign: 'center' },
  ghostBtn:       { background: 'transparent', border: 'none', color: '#555', cursor: 'pointer', fontSize: 13 },
  clearBtn:       { background: 'transparent', border: 'none', color: '#555', cursor: 'pointer', fontSize: 16 },
  actions:        { display: 'flex', gap: 10, marginTop: 8 },
  scheduleBox:    { background: '#0e0e0e', border: '1px solid #1c1c1c', borderRadius: 10, padding: 16, marginTop: 12 },
  errorBox:       { background: '#1e0d0d', border: '1px solid #4a1a1a', borderRadius: 8, padding: '10px 14px', color: '#ff7070', fontSize: 13, marginBottom: 16 },
  successBox:     { background: '#0d1e0d', border: '1px solid #1a4a1a', borderRadius: 8, padding: '10px 14px', color: '#70ff70', fontSize: 13, marginBottom: 16 },
  badge:          { display: 'inline-block', marginTop: 6, fontSize: 11, color: '#70ff70', background: '#0d1e0d', border: '1px solid #1a4a1a', borderRadius: 4, padding: '2px 8px' },
  reviewHeader:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  onScreenBox:    { background: '#0a0a14', border: '1px solid #2a2a4a', borderRadius: 10, padding: '14px 16px', marginBottom: 20 },
  onScreenHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  onScreenLabel:  { fontSize: 10, fontWeight: 800, color: '#7b6fff', letterSpacing: '1.5px', textTransform: 'uppercase' },
  copyBtn:        { padding: '4px 12px', background: '#1a1a3a', border: '1px solid #3a3a6a', borderRadius: 6, color: '#7b6fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  toggleRow:      { display: 'flex', flexDirection: 'column' },
  editGrid:       { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 },
  igNotice:       { background: '#0a0e1a', border: '1px solid #1e2a4a', borderRadius: 10, padding: 16 },
  center:         { textAlign: 'center', padding: '60px 0' },
  processingTitle:{ fontSize: 18, fontWeight: 600, color: '#fff', marginBottom: 8, marginTop: 16 },
  spinner:        { width: 44, height: 44, border: '3px solid #222', borderTopColor: '#833ab4', borderRadius: '50%', animation: 'spin .8s linear infinite', margin: '0 auto' },
  miniSpinner:    { display: 'inline-block', width: 14, height: 14, border: '2px solid rgba(255,255,255,.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin .6s linear infinite' },
};

const popupStyle = {
  box:   { background: '#0d0d14', border: '1px solid #2a2a4a', borderRadius: 16, padding: '40px 32px', maxWidth: 340, margin: '0 auto', textAlign: 'center' },
  icon:  { fontSize: 56, marginBottom: 16 },
  title: { fontSize: 22, fontWeight: 700, color: '#fff', marginBottom: 12 },
  desc:  { fontSize: 14, color: '#888', lineHeight: 1.7, marginBottom: 28, whiteSpace: 'pre-line' },
  btn:   { padding: '12px 32px', background: 'linear-gradient(135deg,#833ab4,#fd1d1d)', color: '#fff', border: 'none', borderRadius: 10, fontSize: 15, fontWeight: 700, cursor: 'pointer' },
};
