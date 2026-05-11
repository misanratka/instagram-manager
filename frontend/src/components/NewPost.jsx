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

const SIZES = [
  { label: 'Small',  value: 'small',  px: 13 },
  { label: 'Medium', value: 'medium', px: 18 },
  { label: 'Large',  value: 'large',  px: 26 },
  { label: 'XL',     value: 'xl',     px: 38 },
];

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

function newBox() {
  return { id: Date.now(), text: '', xPct: 50, yPct: 50, color: 'white', size: 'large', bg: 'none', startTime: 0, endTime: 0 };
}

// ── Fullscreen modal text-on-video editor ─────────────────────────────────────
function TextEditorModal({ videoSrc, textBoxes, onChange, onClose }) {
  const containerRef = useRef();
  const taRef        = useRef();
  const [selected, setSelected] = useState(null);
  const [dragging, setDragging] = useState(null);

  function addBox() {
    const box = { id: Date.now(), text: '', xPct: 50, yPct: 50, color: 'white', size: 'large', fontSize: 44, bg: 'none', align: 'center', startTime: 0, endTime: 0 };
    onChange(prev => [...prev, box]);
    setSelected(box.id);
  }

  function removeBox(id) {
    onChange(prev => prev.filter(b => b.id !== id));
    setSelected(null);
  }

  function updateBox(id, key, val) {
    onChange(prev => prev.map(b => b.id === id ? { ...b, [key]: val } : b));
  }

  function insertLineBreak() {
    const ta = taRef.current;
    if (!ta || !sel) return;
    const start = ta.selectionStart ?? sel.text.length;
    const end   = ta.selectionEnd   ?? sel.text.length;
    const next  = sel.text.slice(0, start) + '\n' + sel.text.slice(end);
    updateBox(sel.id, 'text', next);
    requestAnimationFrame(() => { ta.focus(); ta.setSelectionRange(start + 1, start + 1); });
  }

  function handlePointerDown(e, id) {
    e.preventDefault();
    e.stopPropagation();
    setSelected(id);
    setDragging({ id });
  }

  useEffect(() => {
    if (!dragging) return;
    function clientPos(e) {
      return e.touches ? { cx: e.touches[0].clientX, cy: e.touches[0].clientY } : { cx: e.clientX, cy: e.clientY };
    }
    function onMove(e) {
      e.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const { cx, cy } = clientPos(e);
      onChange(prev => prev.map(b => b.id === dragging.id ? {
        ...b,
        xPct: Math.max(2, Math.min(98, ((cx - rect.left) / rect.width) * 100)),
        yPct: Math.max(2, Math.min(98, ((cy - rect.top) / rect.height) * 100)),
      } : b));
    }
    function onUp() { setDragging(null); }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };
  }, [dragging]);

  const sel = textBoxes.find(b => b.id === selected);

  function getBoxStyle(box) {
    const sizePx = box.fontSize || 44;
    const base = {
      position: 'absolute', left: `${box.xPct}%`, top: `${box.yPct}%`,
      transform: 'translate(-50%,-50%)', fontSize: sizePx, fontWeight: 'bold',
      fontFamily: 'sans-serif', cursor: 'move', whiteSpace: 'pre',
      pointerEvents: 'all', borderRadius: 4, padding: '3px 10px',
      textAlign: box.align || 'center',
      outline: selected === box.id ? '2px dashed rgba(255,255,255,0.7)' : 'none',
    };
    if (box.bg === 'black') return { ...base, background: 'rgba(0,0,0,0.85)', color: '#fff', textShadow: 'none' };
    if (box.bg === 'white') return { ...base, background: 'rgba(255,255,255,0.92)', color: '#111', textShadow: 'none' };
    return { ...base, background: 'transparent', color: box.color === 'black' ? '#111' : (box.color || 'white'), textShadow: '1px 1px 4px rgba(0,0,0,1),-1px -1px 4px rgba(0,0,0,1)' };
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#000', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', background: '#111', borderBottom: '1px solid #222', flexShrink: 0 }}>
        <button onClick={onClose} style={{ background: 'linear-gradient(135deg,#833ab4,#fd1d1d)', border: 'none', borderRadius: 8, color: '#fff', padding: '8px 18px', fontWeight: 700, cursor: 'pointer', fontSize: 14 }}>✓ Done</button>
        <span style={{ color: '#888', fontSize: 13 }}>Drag text to position</span>
        <button onClick={addBox} style={{ background: '#1a1a2e', border: '1px solid #444', borderRadius: 8, color: '#ccc', padding: '8px 16px', cursor: 'pointer', fontSize: 14 }}>+ Add Text</button>
      </div>

      {/* Video canvas */}
      <div
        ref={containerRef}
        onClick={() => setSelected(null)}
        style={{ flex: 1, position: 'relative', overflow: 'hidden', touchAction: 'none', userSelect: 'none', background: '#000' }}
      >
        {videoSrc
          ? <video src={videoSrc} controls style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
          : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#444', fontSize: 14 }}>No video preview</div>
        }
        {textBoxes.map(box => (
          <div
            key={box.id}
            style={getBoxStyle(box)}
            onMouseDown={e => handlePointerDown(e, box.id)}
            onTouchStart={e => handlePointerDown(e, box.id)}
          >
            {box.text || <span style={{ opacity: 0.5 }}>tap to edit</span>}
          </div>
        ))}
      </div>

      {/* Edit panel — only when a box is selected */}
      {sel && (
        <div style={{ background: '#0a0a12', borderTop: '2px solid #2a2a4a', padding: '14px 16px', flexShrink: 0 }} onClick={e => e.stopPropagation()}>

          {/* Row 1: textarea + action buttons */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'flex-start' }}>
            <textarea
              ref={taRef}
              autoFocus
              value={sel.text}
              onChange={e => updateBox(sel.id, 'text', e.target.value)}
              placeholder="Type text here… (supports emoji 🔥)"
              rows={3}
              style={{ flex: 1, padding: '10px 12px', background: '#141420', border: '1.5px solid #3a3a5a', borderRadius: 8, color: '#fff', fontSize: 15, outline: 'none', resize: 'none', fontFamily: 'inherit', lineHeight: 1.5 }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <button onClick={insertLineBreak} title="Insert line break at cursor"
                style={{ padding: '10px 12px', background: '#1a1a3a', border: '1px solid #4a4a7a', borderRadius: 7, color: '#aaa', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}>↵</button>
              <button onClick={() => removeBox(sel.id)}
                style={{ padding: '10px 12px', background: '#1a0808', border: '1px solid #4a1a1a', borderRadius: 7, color: '#ff6060', cursor: 'pointer', fontSize: 15, lineHeight: 1 }}>✕</button>
            </div>
          </div>

          {/* Row 2: BG + Size */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: '#666', minWidth: 20 }}>BG</span>
            {[{ v: 'none', label: 'None' }, { v: 'black', label: '■ Black' }, { v: 'white', label: '□ White' }].map(bg => (
              <button key={bg.v} onClick={() => updateBox(sel.id, 'bg', bg.v)}
                style={{ padding: '7px 14px', borderRadius: 7, border: sel.bg === bg.v ? '2px solid #7b6fff' : '1.5px solid #2a2a3a', background: sel.bg === bg.v ? '#1e1e40' : '#141420', color: sel.bg === bg.v ? '#fff' : '#888', cursor: 'pointer', fontSize: 13, fontWeight: sel.bg === bg.v ? 700 : 400 }}>
                {bg.label}
              </button>
            ))}
            <div style={{ flex: 1 }} />
            <span style={{ fontSize: 11, color: '#666' }}>Size</span>
            <input type="number" min={8} max={200}
              value={sel.fontSize || 44}
              onChange={e => updateBox(sel.id, 'fontSize', Math.max(8, Math.min(200, Number(e.target.value) || 44)))}
              style={{ width: 62, padding: '7px 8px', background: '#141420', border: '1.5px solid #3a3a5a', borderRadius: 7, color: '#fff', fontSize: 14, outline: 'none', textAlign: 'center' }}
            />
            <span style={{ fontSize: 11, color: '#444' }}>px</span>
          </div>

          {/* Row 3: Align + Color swatches */}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: '#666', minWidth: 20 }}>Align</span>
            {[['left','←'],['center','≡'],['right','→']].map(([val, icon]) => (
              <button key={val} onClick={() => updateBox(sel.id, 'align', val)}
                style={{ width: 38, height: 34, borderRadius: 7, border: (sel.align || 'center') === val ? '2px solid #7b6fff' : '1.5px solid #2a2a3a', background: (sel.align || 'center') === val ? '#1e1e40' : '#141420', color: (sel.align || 'center') === val ? '#fff' : '#777', cursor: 'pointer', fontSize: 17 }}>
                {icon}
              </button>
            ))}
            {sel.bg === 'none' && (
              <>
                <div style={{ width: 1, height: 24, background: '#2a2a3a', margin: '0 4px' }} />
                {COLORS.map(c => (
                  <button key={c.value} title={c.label} onClick={() => updateBox(sel.id, 'color', c.value)}
                    style={{ width: 26, height: 26, borderRadius: '50%', background: c.hex, border: sel.color === c.value ? '2.5px solid #fff' : '1.5px solid #333', cursor: 'pointer', flexShrink: 0 }} />
                ))}
              </>
            )}
          </div>
        </div>
      )}

      {!sel && textBoxes.length === 0 && (
        <div style={{ padding: '12px 16px', textAlign: 'center', color: '#444', fontSize: 13, flexShrink: 0 }}>
          Tap "+ Add Text" to add text on the video
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
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
  // Editing
  const [trimStart, setTrimStart]   = useState('');
  const [trimEnd, setTrimEnd]       = useState('');
  const [brightness, setBrightness] = useState(0);
  const [contrast, setContrast]     = useState(1);
  const [saturation, setSaturation] = useState(1);
  const [speed, setSpeed]           = useState(1);
  const [cropRatio, setCropRatio]   = useState('none');
  // Posting
  const [scheduling, setScheduling]     = useState(false);
  const [scheduleTime, setScheduleTime] = useState('');
  const [posting, setPosting]           = useState(false);
  const [error, setError]               = useState('');
  const [success, setSuccess]           = useState('');
  const [popup, setPopup]               = useState(null); // { type: 'posted'|'scheduled', detail }
  const fileRef = useRef();

  function showPopup(type, detail) {
    setPopup({ type, detail });
  }
  function closePopup() {
    setPopup(null);
    reset();
  }

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
        textOverlays:  textBoxes.filter(b => b.text),
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
    setPosting(true); setError('');
    try {
      await api.updateCaption(result.postId, { caption, hookText: '' });
      await api.publishPost(result.postId, { account_id: accountId, caption });
      showPopup('posted');
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
  const isIgCaption  = !!(result?.instagramUrl && !result?.videoUrl); // Instagram URL, no video downloaded

  // ── Confirmation popup ──
  if (popup) {
    const isPosted = popup.type === 'posted';
    return (
      <div style={s.center}>
        <div style={popupStyle.box}>
          <div style={popupStyle.icon}>{isPosted ? '🎉' : '🕐'}</div>
          <div style={popupStyle.title}>
            {isPosted ? 'Reel Submitted!' : 'Reel Scheduled!'}
          </div>
          <div style={popupStyle.desc}>
            {isPosted
              ? 'Your reel is being published to Instagram.\nCheck the Posts tab to see when it goes live.'
              : `Your reel is scheduled for\n${popup.detail}`}
          </div>
          <button onClick={closePopup} style={popupStyle.btn}>
            {isPosted ? 'Post Another' : 'Done'}
          </button>
        </div>
      </div>
    );
  }

  // ── Processing ──
  if (step === STEPS.PROCESSING) {
    return (
      <div style={s.center}>
        <div style={s.spinner} />
        <div style={s.processingTitle}>Processing video…</div>
        <div style={s.hint}>Downloading video and rewriting caption with AI. This may take a moment.</div>
      </div>
    );
  }

  // ── Review ──
  if (step === STEPS.REVIEW && result) {
    return (
      <div>
        <div style={s.reviewHeader}>
          <h2 style={s.h2}>Review & Post</h2>
          <button onClick={reset} style={s.ghostBtn}>✕ Start over</button>
        </div>

        {error   && <div style={s.errorBox}>{error}</div>}
        {success && <div style={s.successBox}>{success}</div>}

        {/* ON-SCREEN TEXT */}
        <div style={s.onScreenBox}>
          <div style={s.onScreenHeader}>
            <span style={s.onScreenLabel}>ON-SCREEN TEXT (for CapCut / Premiere)</span>
            <button onClick={() => navigator.clipboard.writeText(onScreenText)} style={s.copyBtn}>Copy</button>
          </div>
          <textarea
            value={onScreenText}
            onChange={e => setOnScreenText(e.target.value)}
            rows={2}
            placeholder="Add on-screen text…"
            style={{ ...s.textarea, fontSize: 16, fontWeight: 600, lineHeight: 1.5, background: 'transparent', border: '1px solid #2a2a4a', color: '#fff', resize: 'vertical' }}
          />
        </div>

        {/* INSTAGRAM CAPTION MODE — no video downloaded */}
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

        {/* VIDEO + TEXT EDITOR (only when video is available) */}
        {!isIgCaption && (
          <>
            <Section label="Video">
              <div style={{ position: 'relative', background: '#000', borderRadius: 8, overflow: 'hidden' }}>
                {previewUrl
                  ? <video src={previewUrl} controls style={{ width: '100%', display: 'block', maxHeight: 380 }} />
                  : <div style={{ height: 120, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#333', fontSize: 13 }}>No video preview</div>
                }
                {/* read-only text overlay preview */}
                {textBoxes.map(box => {
                  const sizePx = SIZES.find(sz => sz.value === box.size)?.px ?? 18;
                  const isBlack = box.bg === 'black';
                  const isWhite = box.bg === 'white';
                  return (
                    <div key={box.id} style={{
                      position: 'absolute', left: `${box.xPct}%`, top: `${box.yPct}%`,
                      transform: 'translate(-50%,-50%)', fontSize: sizePx * 0.7, fontWeight: 'bold',
                      fontFamily: 'sans-serif', pointerEvents: 'none', borderRadius: 4, padding: '2px 6px',
                      background: isBlack ? 'rgba(0,0,0,0.85)' : isWhite ? 'rgba(255,255,255,0.92)' : 'transparent',
                      color: isBlack ? '#fff' : isWhite ? '#111' : (box.color || 'white'),
                      textShadow: (!isBlack && !isWhite) ? '1px 1px 3px rgba(0,0,0,1)' : 'none',
                      whiteSpace: 'nowrap',
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

            {/* CROP */}
            <Section label="Crop / Aspect Ratio">
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {CROP_RATIOS.map(r => (
                  <button
                    key={r.value}
                    onClick={() => setCropRatio(r.value)}
                    style={{
                      ...s.cropBtn,
                      background:   cropRatio === r.value ? 'linear-gradient(135deg,#833ab4,#fd1d1d)' : '#111',
                      color:        cropRatio === r.value ? '#fff' : '#888',
                      border:       cropRatio === r.value ? 'none' : '1px solid #2a2a2a',
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 13 }}>{r.label}</div>
                    {r.desc && <div style={{ fontSize: 10, opacity: 0.75 }}>{r.desc}</div>}
                  </button>
                ))}
              </div>
            </Section>

            {/* ADJUSTMENTS */}
            <Section label="Adjustments">
              <div style={s.editGrid}>
                <div>
                  <div style={s.editLabel}>Trim (seconds)</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input type="number" min="0" placeholder="Start" value={trimStart} onChange={e => setTrimStart(e.target.value)} style={{ ...s.timeInput, flex: 1 }} />
                    <span style={{ color: '#444' }}>→</span>
                    <input type="number" min="0" placeholder="End" value={trimEnd} onChange={e => setTrimEnd(e.target.value)} style={{ ...s.timeInput, flex: 1 }} />
                  </div>
                </div>
                <div>
                  <div style={s.editLabel}>Playback Speed</div>
                  <select value={speed} onChange={e => setSpeed(Number(e.target.value))} style={s.miniSelect}>
                    {SPEEDS.map(sp => <option key={sp.value} value={sp.value}>{sp.label}</option>)}
                  </select>
                </div>
              </div>
              <SliderRow label="Brightness" value={brightness} min={-0.5} max={0.5}  step={0.05} def={0} onChange={setBrightness} />
              <SliderRow label="Contrast"   value={contrast}   min={0.5}  max={2.0}  step={0.05} def={1} onChange={setContrast} />
              <SliderRow label="Saturation" value={saturation} min={0}    max={2.0}  step={0.05} def={1} onChange={setSaturation} />
            </Section>

            {/* QUALITY */}
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
                <Toggle on={enhance}  onChange={setEnhance}  label="Boost Quality"  desc="Sharpen + enhance brightness, contrast & color" />
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

        {/* CAPTION */}
        <Section label="Caption">
          <textarea value={caption} onChange={e => setCaption(e.target.value)} rows={5} style={s.textarea} placeholder="Edit your caption…" />
          <div style={s.charCount}>{caption.length} / 2200</div>
        </Section>

        {/* POST */}
        <Section label="Post to Instagram Account">
          <select value={accountId} onChange={e => setAccountId(e.target.value)} style={s.select}>
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

        {showTextEditor && (
          <TextEditorModal
            videoSrc={previewUrl}
            textBoxes={textBoxes}
            onChange={setTextBoxes}
            onClose={() => setShowTextEditor(false)}
          />
        )}
      </div>
    );
  }

  // ── Input ──
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
      <input ref={ref} type="file" accept="video/*" style={{ display: 'none' }} onChange={e => handleFile(e.target.files[0])} />
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

function SliderRow({ label, value, min, max, step, def, onChange }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
        <span style={{ fontSize: 12, color: '#888' }}>{label}</span>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#ccc', minWidth: 36, textAlign: 'right' }}>{Number(value).toFixed(2)}</span>
          {value !== def && (
            <button onClick={() => onChange(def)} style={{ fontSize: 10, color: '#555', background: 'none', border: '1px solid #333', borderRadius: 4, padding: '1px 5px', cursor: 'pointer' }}>reset</button>
          )}
        </div>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} style={{ width: '100%', accentColor: '#833ab4', cursor: 'pointer' }} />
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
  onScreenText:   { fontSize: 16, color: '#fff', fontWeight: 600, lineHeight: 1.5, whiteSpace: 'pre-wrap' },
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
