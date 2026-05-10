import React, { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';

const STEPS = { INPUT: 'input', PROCESSING: 'processing', REVIEW: 'review', ENHANCE: 'enhance' };

export default function NewPost() {
  const [accounts, setAccounts]           = useState([]);
  const [accountId, setAccountId]         = useState('');
  const [url, setUrl]                     = useState('');
  const [file, setFile]                   = useState(null);
  const [step, setStep]                   = useState(STEPS.INPUT);
  const [result, setResult]               = useState(null);
  const [caption, setCaption]             = useState('');
  const [hookText, setHookText]           = useState('');
  const [enhancedUrl, setEnhancedUrl]     = useState(null);
  const [burnSubs, setBurnSubs]           = useState(false);
  const [addHook, setAddHook]             = useState(false);
  const [enhance, setEnhance]             = useState(false);
  const [enhancing, setEnhancing]         = useState(false);
  const [scheduling, setScheduling]       = useState(false);
  const [scheduleTime, setScheduleTime]   = useState('');
  const [posting, setPosting]             = useState(false);
  const [error, setError]                 = useState('');
  const [success, setSuccess]             = useState('');
  const fileRef = useRef();

  useEffect(() => { api.getAccounts().then(setAccounts).catch(() => {}); }, []);

  function reset() {
    setStep(STEPS.INPUT); setResult(null); setCaption(''); setHookText('');
    setEnhancedUrl(null); setBurnSubs(false); setAddHook(false); setEnhance(false);
    setScheduling(false); setScheduleTime(''); setError(''); setSuccess('');
    setUrl(''); setFile(null);
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
      setHookText(data.hookText || '');
      setStep(STEPS.REVIEW);
    } catch (err) {
      setError(err.message);
      setStep(STEPS.INPUT);
    }
  }

  async function handleEnhance() {
    if (!burnSubs && !addHook && !enhance) return setError('Select at least one enhancement');
    setError(''); setEnhancing(true);
    try {
      await api.updateCaption(result.postId, { caption, hookText });
      const res = await api.enhanceVideo(result.postId, { burnSubtitles: burnSubs, addHook, enhance, hookText });
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
      await api.updateCaption(result.postId, { caption, hookText });
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
      await api.updateCaption(result.postId, { caption, hookText });
      await api.schedulePost(result.postId, {
        scheduled_at: new Date(scheduleTime).toISOString(),
        account_id: accountId,
        caption
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

  const minTime = new Date(Date.now() + 5 * 60000).toISOString().slice(0, 16);
  const previewUrl = enhancedUrl || result?.videoUrl;

  // ── PROCESSING STEP ──────────────────────────────────────────
  if (step === STEPS.PROCESSING) {
    return (
      <div style={s.center}>
        <div style={s.spinner} />
        <div style={s.processingTitle}>Processing video…</div>
        <div style={s.hint}>Downloading, transcribing and generating captions. This may take a minute.</div>
      </div>
    );
  }

  // ── REVIEW STEP ──────────────────────────────────────────────
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
        <Section label="Preview">
          <video src={previewUrl} controls style={s.video} />
          {enhancedUrl && <div style={s.enhancedBadge}>Enhanced version</div>}
        </Section>

        {/* METADATA */}
        {result.metadata?.title && (
          <div style={s.metaRow}><b>Title:</b> {result.metadata.title}</div>
        )}

        {/* HOOK TEXT */}
        <Section label="Hook Text (first 3 seconds overlay)">
          <input
            value={hookText}
            onChange={e => setHookText(e.target.value)}
            placeholder="e.g. You won't believe this..."
            style={s.input}
          />
          <div style={s.hint}>This text will appear as an overlay on the first 3 seconds of your video</div>
        </Section>

        {/* ON SCREEN SUGGESTIONS */}
        {result.onScreenSuggestions?.length > 0 && (
          <Section label="On-Screen Text Suggestions">
            <div style={s.chips}>
              {result.onScreenSuggestions.map((t, i) => (
                <button key={i} onClick={() => setHookText(t)} style={s.chip}>{t}</button>
              ))}
            </div>
            <div style={s.hint}>Click to use as hook text</div>
          </Section>
        )}

        {/* VIDEO ENHANCEMENT */}
        <Section label="Video Enhancement">
          <div style={s.toggleRow}>
            <Toggle on={burnSubs} onChange={setBurnSubs} label="Burn Subtitles" desc="Embed captions from transcript directly into video" disabled={!result.srtContent} />
            <Toggle on={addHook}  onChange={setAddHook}  label="Add Hook Overlay" desc="Show hook text on screen for first 3 seconds" />
            <Toggle on={enhance}  onChange={setEnhance}  label="Enhance Video" desc="Slightly boost brightness, contrast and saturation" />
          </div>
          <button
            onClick={handleEnhance}
            disabled={enhancing || (!burnSubs && !addHook && !enhance)}
            style={{ ...s.btn, ...s.btnSecondary, opacity: enhancing || (!burnSubs && !addHook && !enhance) ? 0.4 : 1, marginTop: 12 }}
          >
            {enhancing ? <><span style={s.miniSpinner} /> Enhancing…</> : 'Apply Enhancements'}
          </button>
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

        {/* ACCOUNT */}
        <Section label="Post to Account">
          <select value={accountId} onChange={e => setAccountId(e.target.value)} style={s.select}>
            <option value="">Select account…</option>
            {accounts.map(a => <option key={a.id} value={a.id}>@{a.username} — {a.name}</option>)}
          </select>
          {accounts.length === 0 && (
            <div style={s.hint}>No accounts yet — go to the Accounts tab to add one.</div>
          )}
        </Section>

        {/* ACTIONS */}
        <div style={s.actions}>
          <button onClick={handlePublish} disabled={posting || !accountId} style={{ ...s.btn, ...s.btnPrimary, opacity: posting || !accountId ? 0.4 : 1 }}>
            {posting ? <><span style={s.miniSpinner} /> Posting…</> : 'Post Now'}
          </button>
          <button onClick={() => setScheduling(v => !v)} style={{ ...s.btn, ...s.btnSecondary }}>
            {scheduling ? 'Cancel Schedule' : 'Schedule'}
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

  // ── INPUT STEP (default) ─────────────────────────────────────
  return (
    <div>
      <h2 style={s.h2}>New Post</h2>

      {error && <div style={s.errorBox}>{error}</div>}

      <Section label="Account">
        <select value={accountId} onChange={e => setAccountId(e.target.value)} style={s.select}>
          <option value="">Select account (optional here, required to post)…</option>
          {accounts.map(a => <option key={a.id} value={a.id}>@{a.username} — {a.name}</option>)}
        </select>
      </Section>

      <Section label="Video">
        <div
          style={s.dropZone}
          onDrop={onDrop}
          onDragOver={e => e.preventDefault()}
          onClick={() => !file && fileRef.current?.click()}
        >
          {file ? (
            <div style={s.fileRow}>
              <span style={{ color: '#ccc' }}>📹 {file.name}</span>
              <button onClick={e => { e.stopPropagation(); setFile(null); }} style={s.clearBtn}>✕</button>
            </div>
          ) : (
            <>
              <div style={s.dropIcon}>⬆</div>
              <div style={{ color: '#555' }}>Drop video file here or <span style={{ color: '#833ab4', cursor: 'pointer' }}>browse</span></div>
              <div style={s.hint}>MP4 / MOV / AVI up to 500 MB</div>
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
              placeholder="https://www.instagram.com/reel/…  or YouTube / TikTok URL"
              style={s.input}
            />
          </>
        )}
      </Section>

      <button
        onClick={handleProcess}
        disabled={!url.trim() && !file}
        style={{ ...s.btn, ...s.btnPrimary, opacity: !url.trim() && !file ? 0.4 : 1 }}
      >
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

function Toggle({ on, onChange, label, desc, disabled }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
      <button
        onClick={() => !disabled && onChange(!on)}
        disabled={disabled}
        style={{
          width: 40, height: 22, borderRadius: 11, border: 'none', cursor: disabled ? 'not-allowed' : 'pointer',
          background: on ? 'linear-gradient(135deg,#833ab4,#fd1d1d)' : '#2a2a2a',
          position: 'relative', flexShrink: 0, transition: 'background .2s', opacity: disabled ? 0.3 : 1
        }}
      >
        <span style={{
          position: 'absolute', top: 3, left: on ? 21 : 3, width: 16, height: 16,
          background: '#fff', borderRadius: '50%', transition: 'left .2s'
        }} />
      </button>
      <div>
        <div style={{ fontSize: 13, color: '#ccc', fontWeight: 500 }}>{label}</div>
        <div style={{ fontSize: 11, color: '#555', marginTop: 1 }}>{desc}</div>
      </div>
    </div>
  );
}

const s = {
  h2:            { fontSize: 22, fontWeight: 700, marginBottom: 24, color: '#fff' },
  label:         { fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 8 },
  input:         { width: '100%', padding: '10px 12px', background: '#111', border: '1px solid #252525', borderRadius: 8, color: '#fff', fontSize: 14, outline: 'none' },
  select:        { width: '100%', padding: '10px 12px', background: '#111', border: '1px solid #252525', borderRadius: 8, color: '#fff', fontSize: 14, outline: 'none', cursor: 'pointer' },
  textarea:      { width: '100%', padding: '10px 12px', background: '#111', border: '1px solid #252525', borderRadius: 8, color: '#fff', fontSize: 14, resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.6, outline: 'none' },
  charCount:     { textAlign: 'right', fontSize: 11, color: '#333', marginTop: 4 },
  dropZone:      { border: '2px dashed #252525', borderRadius: 10, padding: '36px 24px', textAlign: 'center', cursor: 'pointer', marginBottom: 12 },
  dropIcon:      { fontSize: 28, marginBottom: 8, color: '#444' },
  fileRow:       { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  orDivider:     { textAlign: 'center', color: '#333', fontSize: 12, margin: '10px 0' },
  hint:          { fontSize: 11, color: '#444', marginTop: 5 },
  chips:         { display: 'flex', flexWrap: 'wrap', gap: 6 },
  chip:          { padding: '5px 12px', background: '#181818', border: '1px solid #2a2a2a', borderRadius: 20, fontSize: 12, color: '#aaa', cursor: 'pointer' },
  btn:           { padding: '11px 22px', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer', border: 'none', display: 'inline-flex', alignItems: 'center', gap: 8, transition: 'opacity .15s' },
  btnPrimary:    { background: 'linear-gradient(135deg,#833ab4,#fd1d1d)', color: '#fff' },
  btnSecondary:  { background: '#1a1a1a', border: '1px solid #333', color: '#ccc' },
  ghostBtn:      { background: 'transparent', border: 'none', color: '#555', cursor: 'pointer', fontSize: 13, padding: '4px 8px' },
  clearBtn:      { background: 'transparent', border: 'none', color: '#555', cursor: 'pointer', fontSize: 16, lineHeight: 1 },
  actions:       { display: 'flex', gap: 10, marginTop: 8 },
  scheduleBox:   { background: '#0e0e0e', border: '1px solid #1c1c1c', borderRadius: 10, padding: 16, marginTop: 12 },
  errorBox:      { background: '#1e0d0d', border: '1px solid #4a1a1a', borderRadius: 8, padding: '10px 14px', color: '#ff7070', fontSize: 13, marginBottom: 16 },
  successBox:    { background: '#0d1e0d', border: '1px solid #1a4a1a', borderRadius: 8, padding: '10px 14px', color: '#70ff70', fontSize: 13, marginBottom: 16 },
  video:         { width: '100%', borderRadius: 8, maxHeight: 420, background: '#000', display: 'block' },
  enhancedBadge: { display: 'inline-block', marginTop: 6, fontSize: 11, color: '#fcb045', background: '#1a1200', border: '1px solid #3a2a00', borderRadius: 4, padding: '2px 8px' },
  metaRow:       { background: '#0e0e0e', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#888', marginBottom: 16 },
  toggleRow:     { display: 'flex', flexDirection: 'column' },
  center:        { textAlign: 'center', padding: '60px 0' },
  processingTitle: { fontSize: 18, fontWeight: 600, color: '#fff', marginBottom: 8, marginTop: 16 },
  spinner:       { width: 44, height: 44, border: '3px solid #222', borderTopColor: '#833ab4', borderRadius: '50%', animation: 'spin .8s linear infinite', margin: '0 auto' },
  miniSpinner:   { display: 'inline-block', width: 14, height: 14, border: '2px solid rgba(255,255,255,.3)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin .6s linear infinite' },
  reviewHeader:  { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
};
