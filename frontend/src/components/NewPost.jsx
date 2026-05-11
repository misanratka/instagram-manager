import React, { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';

const STEPS = { INPUT: 'input', PROCESSING: 'processing', REVIEW: 'review' };

const COLORS = [
  { label: 'White',  value: 'white',   hex: '#ffffff' },
  { label: 'Yellow', value: 'yellow',  hex: '#ffff00' },
  { label: 'Orange', value: 'orange',  hex: '#ff8800' },
  { label: 'Red',    value: 'red',     hex: '#ff3333' },
  { label: 'Cyan',   value: 'cyan',    hex: '#00ffff' },
  { label: 'Black',  value: 'black',   hex: '#111111' },
];

const POSITIONS = [
  { label: 'Top Left',    value: 'top-left' },
  { label: 'Top Center',  value: 'top-center' },
  { label: 'Top Right',   value: 'top-right' },
  { label: 'Mid Center',  value: 'mid-center' },
  { label: 'Bot Left',    value: 'bot-left' },
  { label: 'Bot Center',  value: 'bot-center' },
  { label: 'Bot Right',   value: 'bot-right' },
];

const SIZES = [
  { label: 'Small',  value: 'small' },
  { label: 'Medium', value: 'medium' },
  { label: 'Large',  value: 'large' },
  { label: 'XL',     value: 'xl' },
];

const SPEEDS = [
  { label: '0.5×',        value: 0.5 },
  { label: '0.75×',       value: 0.75 },
  { label: '1× (normal)', value: 1 },
  { label: '1.5×',        value: 1.5 },
  { label: '2×',          value: 2 },
];

function newOverlay() {
  return { id: Date.now(), text: '', position: 'bot-center', color: 'white', size: 'medium', startTime: 0, endTime: 0 };
}

export default function NewPost() {
  const [accounts, setAccounts]         = useState([]);
  const [accountId, setAccountId]       = useState('');
  const [url, setUrl]                   = useState('');
  const [file, setFile]                 = useState(null);
  const [step, setStep]                 = useState(STEPS.INPUT);
  const [result, setResult]             = useState(null);
  const [caption, setCaption]           = useState('');
  const [onScreenText, setOnScreenText] = useState('');
  const [textOverlays, setTextOverlays] = useState([]);
  const [enhancedUrl, setEnhancedUrl]   = useState(null);
  const [burnSubs, setBurnSubs]         = useState(false);
  const [enhance, setEnhance]           = useState(false);
  const [enhancing, setEnhancing]       = useState(false);
  // Editing
  const [trimStart, setTrimStart]       = useState('');
  const [trimEnd, setTrimEnd]           = useState('');
  const [brightness, setBrightness]     = useState(0);
  const [contrast, setContrast]         = useState(1);
  const [saturation, setSaturation]     = useState(1);
  const [speed, setSpeed]               = useState(1);
  // Posting
  const [scheduling, setScheduling]     = useState(false);
  const [scheduleTime, setScheduleTime] = useState('');
  const [posting, setPosting]           = useState(false);
  const [error, setError]               = useState('');
  const [success, setSuccess]           = useState('');
  const fileRef = useRef();

  useEffect(() => { api.getAccounts().then(setAccounts).catch(() => {}); }, []);

  function reset() {
    setStep(STEPS.INPUT); setResult(null); setCaption('');
    setOnScreenText(''); setTextOverlays([]); setEnhancedUrl(null);
    setBurnSubs(false); setEnhance(false);
    setTrimStart(''); setTrimEnd('');
    setBrightness(0); setContrast(1); setSaturation(1); setSpeed(1);
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
      setStep(STEPS.REVIEW);
    } catch (err) {
      setError(err.message);
      setStep(STEPS.INPUT);
    }
  }

  async function handleEnhance() {
    const hasOverlays = textOverlays.some(o => o.text.trim());
    const hasTrim  = Number(trimStart) > 0 || Number(trimEnd) > 0;
    const hasAdj   = brightness !== 0 || contrast !== 1 || saturation !== 1;
    const hasSpeed = speed !== 1;
    if (!burnSubs && !enhance && !hasOverlays && !hasTrim && !hasAdj && !hasSpeed)
      return setError('Select at least one edit or enhancement option');
    setError(''); setEnhancing(true);
    try {
      await api.updateCaption(result.postId, { caption, hookText: '' });
      const res = await api.enhanceVideo(result.postId, {
        burnSubtitles: burnSubs,
        enhance,
        textOverlays: textOverlays.filter(o => o.text.trim()),
        trim: { start: Number(trimStart) || 0, end: Number(trimEnd) || 0 },
        adjustments: { brightness, contrast, saturation },
        speed
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
    setPosting(true); setError('');
    try {
      await api.updateCaption(result.postId, { caption, hookText: '' });
      await api.publishPost(result.postId, { account_id: accountId, caption });
      setSuccess('Reel posted to Instagram!');
      setTimeout(reset, 3000);
    } catch (err) {
      setError(err.message);
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
      setSuccess(`Scheduled for ${new Date(scheduleTime).toLocaleString()}`);
      setTimeout(reset, 3000);
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

  function addOverlay() { setTextOverlays(prev => [...prev, newOverlay()]); }
  function removeOverlay(id) { setTextOverlays(prev => prev.filter(o => o.id !== id)); }
  function updateOverlay(id, key, val) {
    setTextOverlays(prev => prev.map(o => o.id === id ? { ...o, [key]: val } : o));
  }

  const minTime   = new Date(Date.now() + 5 * 60000).toISOString().slice(0, 16);
  const previewUrl = enhancedUrl || result?.videoUrl;

  if (step === STEPS.PROCESSING) {
    return (
      <div style={s.center}>
        <div style={s.spinner} />
        <div style={s.processingTitle}>Processing video…</div>
        <div style={s.hint}>Downloading and generating caption. This may take a moment.</div>
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

        {/* VIDEO PREVIEW */}
        <div style={s.videoWrap}>
          <video src={previewUrl} controls style={s.video} />
          {enhancedUrl && <div style={s.badge}>✓ Rendered</div>}
        </div>

        {/* ON-SCREEN TEXT */}
        {onScreenText && (
          <div style={s.onScreenBox}>
            <div style={s.onScreenHeader}>
              <span style={s.onScreenLabel}>ON-SCREEN TEXT</span>
              <button onClick={() => navigator.clipboard.writeText(onScreenText)} style={s.copyBtn}>Copy</button>
            </div>
            <div style={s.onScreenText}>{onScreenText}</div>
            <div style={s.hint}>Copy this into CapCut / Premiere / Final Cut as your video overlay text</div>
          </div>
        )}

        {/* VIDEO EDITING */}
        <Section label="Edit Video">
          <div style={s.editGrid}>
            <div>
              <div style={s.editLabel}>Trim (seconds)</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="number" min="0" placeholder="Start s"
                  value={trimStart}
                  onChange={e => setTrimStart(e.target.value)}
                  style={{ ...s.timeInput, flex: 1 }}
                />
                <span style={{ color: '#444', fontSize: 13 }}>→</span>
                <input
                  type="number" min="0" placeholder="End s"
                  value={trimEnd}
                  onChange={e => setTrimEnd(e.target.value)}
                  style={{ ...s.timeInput, flex: 1 }}
                />
              </div>
              <div style={s.hint}>Leave blank to keep full video</div>
            </div>
            <div>
              <div style={s.editLabel}>Playback Speed</div>
              <select value={speed} onChange={e => setSpeed(Number(e.target.value))} style={s.miniSelect}>
                {SPEEDS.map(sp => <option key={sp.value} value={sp.value}>{sp.label}</option>)}
              </select>
            </div>
          </div>

          <SliderRow label="Brightness" value={brightness} min={-0.5} max={0.5} step={0.05} defaultVal={0} onChange={setBrightness} />
          <SliderRow label="Contrast"   value={contrast}   min={0.5}  max={2.0} step={0.05} defaultVal={1} onChange={setContrast} />
          <SliderRow label="Saturation" value={saturation} min={0}    max={2.0} step={0.05} defaultVal={1} onChange={setSaturation} />
        </Section>

        {/* TEXT OVERLAYS */}
        <Section label="Text Overlays (burned into video)">
          {textOverlays.map(o => (
            <div key={o.id} style={s.overlayCard}>
              <div style={s.overlayRow}>
                <input
                  value={o.text}
                  onChange={e => updateOverlay(o.id, 'text', e.target.value)}
                  placeholder="Type your text…"
                  style={{ ...s.input, flex: 1 }}
                />
                <button onClick={() => removeOverlay(o.id)} style={s.removeBtn}>✕</button>
              </div>
              <div style={s.overlayControls}>
                <select value={o.position} onChange={e => updateOverlay(o.id, 'position', e.target.value)} style={s.miniSelect}>
                  {POSITIONS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
                <select value={o.size} onChange={e => updateOverlay(o.id, 'size', e.target.value)} style={s.miniSelect}>
                  {SIZES.map(sz => <option key={sz.value} value={sz.value}>{sz.label}</option>)}
                </select>
                <div style={s.colorRow}>
                  {COLORS.map(c => (
                    <button
                      key={c.value}
                      title={c.label}
                      onClick={() => updateOverlay(o.id, 'color', c.value)}
                      style={{
                        ...s.colorDot,
                        background: c.hex,
                        boxShadow: o.color === c.value ? `0 0 0 2px #fff` : 'none'
                      }}
                    />
                  ))}
                </div>
                <div style={s.timingRow}>
                  <input type="number" min="0" placeholder="Start s" value={o.startTime || ''} onChange={e => updateOverlay(o.id, 'startTime', Number(e.target.value))} style={s.timeInput} />
                  <span style={{ color: '#444', fontSize: 11 }}>→</span>
                  <input type="number" min="0" placeholder="End s" value={o.endTime || ''} onChange={e => updateOverlay(o.id, 'endTime', Number(e.target.value))} style={s.timeInput} />
                </div>
              </div>
            </div>
          ))}
          <button onClick={addOverlay} style={s.addOverlayBtn}>+ Add Text Overlay</button>
        </Section>

        {/* ENHANCEMENTS */}
        <Section label="Quality Enhancements">
          <div style={s.toggleRow}>
            <Toggle on={burnSubs} onChange={setBurnSubs} label="Burn Subtitles" desc="Embed transcript captions into video" disabled={!result.srtContent} />
            <Toggle on={enhance}  onChange={setEnhance}  label="Boost Quality"  desc="Sharpen + improve brightness, contrast & color" />
          </div>
          <button
            onClick={handleEnhance}
            disabled={enhancing}
            style={{ ...s.btn, ...s.btnSecondary, marginTop: 12, opacity: enhancing ? 0.5 : 1 }}
          >
            {enhancing ? <><span style={s.miniSpinner} /> Rendering…</> : 'Apply Edits & Render Video'}
          </button>
          <div style={s.hint}>Renders a new video with all your edits applied. You can render multiple times.</div>
        </Section>

        {/* CAPTION */}
        <Section label="Caption">
          <textarea
            value={caption}
            onChange={e => setCaption(e.target.value)}
            rows={5}
            style={s.textarea}
            placeholder="Edit your caption…"
          />
          <div style={s.charCount}>{caption.length} / 2200</div>
        </Section>

        {/* ACCOUNT + POST */}
        <Section label="Post to Instagram Account">
          <select value={accountId} onChange={e => setAccountId(e.target.value)} style={s.select}>
            <option value="">Select account…</option>
            {accounts.map(a => <option key={a.id} value={a.id}>@{a.username} — {a.name}</option>)}
          </select>
          {accounts.length === 0 && (
            <div style={s.hint}>No accounts yet — go to the Accounts tab and click "Connect Instagram".</div>
          )}
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
            <input type="datetime-local" min={minTime} value={scheduleTime} onChange={e => setScheduleTime(e.target.value)} style={s.input} />
            <button
              onClick={handleSchedule}
              disabled={!scheduleTime || posting || !accountId}
              style={{ ...s.btn, ...s.btnPrimary, marginTop: 10, opacity: !scheduleTime || posting || !accountId ? 0.4 : 1 }}
            >
              {posting ? 'Scheduling…' : 'Confirm Schedule'}
            </button>
          </div>
        )}
      </div>
    );
  }

  // INPUT STEP
  return (
    <div>
      <h2 style={s.h2}>New Post</h2>
      {error && <div style={s.errorBox}>{error}</div>}

      <Section label="Account (optional)">
        <select value={accountId} onChange={e => setAccountId(e.target.value)} style={s.select}>
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
        <input ref={fileRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={e => { setFile(e.target.files[0]); setUrl(''); }} />

        {!file && (
          <>
            <div style={s.orDivider}>or paste a link</div>
            <input
              type="text"
              value={url}
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

function Section({ label, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 8 }}>{label}</div>
      {children}
    </div>
  );
}

function SliderRow({ label, value, min, max, step, defaultVal, onChange }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontSize: 12, color: '#888' }}>{label}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#ccc', minWidth: 36, textAlign: 'right' }}>{Number(value).toFixed(2)}</span>
          {value !== defaultVal && (
            <button onClick={() => onChange(defaultVal)} style={{ fontSize: 10, color: '#555', background: 'none', border: '1px solid #333', borderRadius: 4, padding: '1px 6px', cursor: 'pointer' }}>reset</button>
          )}
        </div>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        style={{ width: '100%', accentColor: '#833ab4', cursor: 'pointer' }}
      />
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
  miniSelect:     { padding: '6px 8px', background: '#111', border: '1px solid #252525', borderRadius: 6, color: '#ccc', fontSize: 12, outline: 'none', cursor: 'pointer' },
  timeInput:      { width: 64, padding: '8px 10px', background: '#111', border: '1px solid #252525', borderRadius: 6, color: '#ccc', fontSize: 13, outline: 'none' },
  dropZone:       { border: '2px dashed #252525', borderRadius: 10, padding: '36px 24px', textAlign: 'center', cursor: 'pointer', marginBottom: 12 },
  dropIcon:       { fontSize: 28, marginBottom: 8, color: '#444' },
  fileRow:        { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  orDivider:      { textAlign: 'center', color: '#333', fontSize: 12, margin: '10px 0' },
  hint:           { fontSize: 11, color: '#444', marginTop: 5 },
  btn:            { padding: '11px 22px', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', border: 'none', display: 'inline-flex', alignItems: 'center', gap: 8, transition: 'opacity .15s' },
  btnPrimary:     { background: 'linear-gradient(135deg,#833ab4,#fd1d1d)', color: '#fff' },
  btnSecondary:   { background: '#1a1a1a', border: '1px solid #333', color: '#ccc' },
  addOverlayBtn:  { padding: '8px 16px', background: '#111', border: '1px dashed #333', borderRadius: 8, color: '#888', cursor: 'pointer', fontSize: 13, marginTop: 8 },
  removeBtn:      { padding: '6px 10px', background: 'transparent', border: 'none', color: '#444', cursor: 'pointer', fontSize: 16, flexShrink: 0 },
  ghostBtn:       { background: 'transparent', border: 'none', color: '#555', cursor: 'pointer', fontSize: 13 },
  clearBtn:       { background: 'transparent', border: 'none', color: '#555', cursor: 'pointer', fontSize: 16 },
  actions:        { display: 'flex', gap: 10, marginTop: 8 },
  scheduleBox:    { background: '#0e0e0e', border: '1px solid #1c1c1c', borderRadius: 10, padding: 16, marginTop: 12 },
  errorBox:       { background: '#1e0d0d', border: '1px solid #4a1a1a', borderRadius: 8, padding: '10px 14px', color: '#ff7070', fontSize: 13, marginBottom: 16 },
  successBox:     { background: '#0d1e0d', border: '1px solid #1a4a1a', borderRadius: 8, padding: '10px 14px', color: '#70ff70', fontSize: 13, marginBottom: 16 },
  videoWrap:      { position: 'relative', marginBottom: 20 },
  video:          { width: '100%', borderRadius: 8, maxHeight: 420, background: '#000', display: 'block' },
  badge:          { display: 'inline-block', marginTop: 6, fontSize: 11, color: '#70ff70', background: '#0d1e0d', border: '1px solid #1a4a1a', borderRadius: 4, padding: '2px 8px' },
  reviewHeader:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  onScreenBox:    { background: '#0a0a14', border: '1px solid #2a2a4a', borderRadius: 10, padding: '14px 16px', marginBottom: 20 },
  onScreenHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  onScreenLabel:  { fontSize: 10, fontWeight: 800, color: '#7b6fff', letterSpacing: '1.5px', textTransform: 'uppercase' },
  onScreenText:   { fontSize: 16, color: '#fff', fontWeight: 600, lineHeight: 1.5, whiteSpace: 'pre-wrap' },
  copyBtn:        { padding: '4px 12px', background: '#1a1a3a', border: '1px solid #3a3a6a', borderRadius: 6, color: '#7b6fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  toggleRow:      { display: 'flex', flexDirection: 'column' },
  overlayCard:    { background: '#0d0d0d', border: '1px solid #1c1c1c', borderRadius: 8, padding: 12, marginBottom: 8 },
  overlayRow:     { display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 },
  overlayControls:{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  colorRow:       { display: 'flex', gap: 5, alignItems: 'center' },
  colorDot:       { width: 18, height: 18, borderRadius: '50%', border: '1px solid #333', cursor: 'pointer', flexShrink: 0 },
  timingRow:      { display: 'flex', gap: 4, alignItems: 'center' },
  editGrid:       { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 },
  center:         { textAlign: 'center', padding: '60px 0' },
  processingTitle:{ fontSize: 18, fontWeight: 600, color: '#fff', marginBottom: 8, marginTop: 16 },
  spinner:        { width: 44, height: 44, border: '3px solid #222', borderTopColor: '#833ab4', borderRadius: '50%', animation: 'spin .8s linear infinite', margin: '0 auto' },
  miniSpinner:    { display: 'inline-block', width: 14, height: 14, border: '2px solid rgba(255,255,255,.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin .6s linear infinite' },
};
