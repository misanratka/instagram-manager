import React, { useState, useEffect, useRef } from 'react';
import { api, mediaUrl } from '../services/api';
import CaptionOptions, { RegenerateBar } from './CaptionOptions';
import FrameEditor from './FrameEditor';

// "Multi" tab: one clip -> any number of connected accounts.
// Same processing as Create, but fixed to: no page branding (on-screen text only), best video quality,
// and a checklist of accounts to post to. Create / Autopilot are untouched.

const STEP = { INPUT: 'input', PROCESSING: 'processing', REVIEW: 'review', DONE: 'done' };
const FULL_FRAME = { top: 0, bottom: 1, left: 0, right: 1, zoom: 1, offsetY: 0, cardScale: 1 };
const POLL_MS = 2500;
const POLL_TIMEOUT_MS = 4 * 60 * 1000;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export default function QuickPost() {
  const [accounts, setAccounts] = useState([]);
  const [picked, setPicked]     = useState(() => { try { return JSON.parse(localStorage.getItem('im_multi_accts') || '[]'); } catch { return []; } });   // selected account ids
  const [url, setUrl]           = useState('');
  const [file, setFile]         = useState(null);
  const [step, setStep]         = useState(STEP.INPUT);
  const [result, setResult]     = useState(null);
  const [caption, setCaption]   = useState('');
  const [onScreen, setOnScreen] = useState('');
  const [capOpts, setCapOpts]   = useState({});
  const [theme, setTheme]       = useState(() => { try { return localStorage.getItem('im_theme') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; } });
  const [frame, setFrame]       = useState(FULL_FRAME);
  const [autoFrame, setAutoFrame] = useState(null);
  const [cardImg, setCardImg]   = useState('');
  const [cardH, setCardH]       = useState(null);
  const [canvasColor, setCanvasColor] = useState('#000000');
  const [badPreview, setBadPreview]   = useState('');
  const [jobInfo, setJobInfo]   = useState(null);
  const [busy, setBusy]         = useState(false);
  const [status, setStatus]     = useState('');
  const [error, setError]       = useState('');
  const [results, setResults]   = useState([]);          // [{ accountId, name, username, state: 'sending'|'publishing'|'posted'|'failed', error }]
  const fileRef = useRef(null);

  useEffect(() => {
    api.getAccounts().then(a => { setAccounts(a); setPicked(p => p.filter(id => a.some(x => x.id === id))); }).catch(() => {});
  }, []);
  useEffect(() => { try { localStorage.setItem('im_multi_accts', JSON.stringify(picked)); } catch {} }, [picked]);

  // New clip -> start from the auto-detected crop (black bars removed)
  useEffect(() => {
    const a = result?.autoCrop;
    const f = a ? { ...FULL_FRAME, top: a.y, bottom: a.y + a.h, left: a.x, right: a.x + a.w } : { ...FULL_FRAME };
    setFrame(f); setAutoFrame(a ? f : null);
  }, [result?.postId]);

  // Live preview of the text-only layout
  useEffect(() => {
    if (step !== STEP.REVIEW || !result) { setCardImg(''); return; }
    const t = setTimeout(() => {
      api.cardPreview(null, onScreen, frame.cardScale, 'text', theme)
        .then(r => { setCardImg(r.image); setCardH(r.height); setCanvasColor(r.canvasColor || '#000000'); })
        .catch(() => setCardImg(''));
    }, 400);
    return () => clearTimeout(t);
  }, [step, theme, onScreen, frame.cardScale, result?.postId]);

  const toggle = (id) => setPicked(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  const allOn = accounts.length > 0 && picked.length === accounts.length;
  const setThemeSaved = (t) => { setTheme(t); try { localStorage.setItem('im_theme', t); } catch {} };

  function reset() {
    setStep(STEP.INPUT); setResult(null); setCaption(''); setOnScreen(''); setCapOpts({});
    setUrl(''); setFile(null); setError(''); setStatus(''); setResults([]); setBusy(false); setJobInfo(null);
  }

  async function handlePasteAndProcess() {
    let text = '';
    try { text = await navigator.clipboard.readText(); } catch { return setError('Could not read the clipboard. Paste the link into the box instead.'); }
    const m = (text || '').match(/https?:\/\/[^\s]+/i);
    if (!m) return setError('No link in your clipboard. Copy the video link first.');
    const link = m[0].replace(/[)\].,;]+$/, '');
    setFile(null); setUrl(link);
    await handleProcess(link);
  }

  async function handleProcess(linkOverride) {
    const link = (typeof linkOverride === 'string' ? linkOverride : url).trim();
    if (!link && !file) return setError('Choose a video from your device or paste a link.');
    setError(''); setJobInfo(null); setStep(STEP.PROCESSING);
    try {
      const data = file
        ? await api.processFile(file, null, capOpts, setJobInfo)
        : await api.processUrl(link, null, capOpts, setJobInfo);
      setResult(data);
      setCaption(data.generatedCaption || '');
      setOnScreen(data.hookText || '');
      setStep(STEP.REVIEW);
    } catch (e) {
      setError(e.message); setStep(STEP.INPUT);
    }
  }

  function guardOk() {
    const g = result?.guard;
    if (!g || g.level === 'clear') return true;
    setError('Not posted — safety check:\n' + (g.reasons || []).map(r => '• ' + r).join('\n'));
    return false;
  }

  const setRow = (accountId, patch) => setResults(rs => rs.map(r => r.accountId === accountId ? { ...r, ...patch } : r));

  async function handlePost() {
    if (!picked.length) return setError('Pick at least one account.');
    if (!result?.postId) return;
    if (!guardOk()) return;
    setBusy(true); setError('');
    try {
      await api.updateCaption(result.postId, { caption, hookText: '' });

      // 1) Render once: text-only layout, best quality. Every account gets this same file.
      setStatus('Rendering video…');
      await api.enhanceVideo(result.postId, {
        brandCard: { enabled: true, mode: 'text', text: onScreen, frame, quality: 'best', theme },
      }, (j) => setStatus(j.status === 'queued' ? 'Rendering video… waiting for another job to finish' : `Rendering video… ${j.elapsed_s || 0}s`));

      // 2) One copy per account
      setStatus('Preparing accounts…');
      const { posts } = await api.clonePost(result.postId, picked);
      const rows = posts.map(p => ({ ...p, state: 'sending', error: '' }));
      setResults(rows); setStep(STEP.DONE);

      // 3) Publish each (the server publishes in the background, so these calls return fast)
      setStatus('Sending to Instagram…');
      const live = new Set();                       // post ids still publishing
      const queue = [...rows];
      const worker = async () => {
        for (let row = queue.shift(); row; row = queue.shift()) {
          try {
            await api.publishPost(row.postId, { account_id: row.accountId, caption });
            setRow(row.accountId, { state: 'publishing' });
            live.add(row.postId);
          } catch (e) {
            setRow(row.accountId, { state: 'failed', error: e.message });
          }
        }
      };
      await Promise.all([worker(), worker(), worker()]);

      // 4) Watch until every account is posted or failed
      const started = Date.now();
      while (live.size && Date.now() - started < POLL_TIMEOUT_MS) {
        await sleep(POLL_MS);
        const posts2 = await api.getPosts().catch(() => null);
        if (!posts2) continue;
        for (const row of rows) {
          if (!live.has(row.postId)) continue;
          const p = posts2.find(x => x.id === row.postId);
          if (!p) continue;
          if (p.status === 'posted') { setRow(row.accountId, { state: 'posted', error: '' }); live.delete(row.postId); }
          else if (p.status === 'failed') { setRow(row.accountId, { state: 'failed', error: p.error_message || 'Instagram publishing failed.' }); live.delete(row.postId); }
        }
      }
      setStatus('');
      // original un-assigned draft is no longer needed
      api.deletePost(result.postId).catch(() => {});
    } catch (e) {
      setError(e.message); setStatus('');
    } finally {
      setBusy(false);
    }
  }

  const srcUrl = mediaUrl(result?.videoUrl);
  const guard = result?.guard;
  const blocked = guard && guard.level && guard.level !== 'clear';

  // ── INPUT ──────────────────────────────────────────────────────────────────
  if (step === STEP.INPUT) return (
    <div>
      <h2 style={s.h2}>One clip, many accounts</h2>
      <p style={s.sub}>On-screen text only (no page branding), best video quality. You pick which accounts it goes to.</p>

      <div style={s.card} className="glass">
        <button type="button" onClick={handlePasteAndProcess} className="shine" style={{ ...s.btn, ...s.primary, marginBottom: 10 }}>
          📋 Paste copied link &amp; process
        </button>
        <button type="button" onClick={() => fileRef.current?.click()} style={s.pickBtn}>
          {file ? `📁 ${file.name}` : '📁 Choose video from device'}
        </button>
        <input ref={fileRef} type="file" accept="video/*" style={{ display: 'none' }}
          onChange={e => { const f = e.target.files?.[0]; if (f) { setFile(f); setUrl(''); } }} />
        <div style={s.or}>or</div>
        <input id="multi-url" name="url" style={s.input} value={url} placeholder="Paste a video link"
          onChange={e => { setUrl(e.target.value); if (e.target.value) setFile(null); }} />
      </div>

      <CaptionOptions value={capOpts} onChange={setCapOpts} />

      {error && <div style={s.err}>{error}</div>}
      <button onClick={() => handleProcess()} disabled={!url.trim() && !file} className="shine"
        style={{ ...s.btn, ...s.primary, opacity: !url.trim() && !file ? 0.4 : 1 }}>
        Process clip
      </button>
    </div>
  );

  // ── PROCESSING ─────────────────────────────────────────────────────────────
  if (step === STEP.PROCESSING) return (
    <div style={{ textAlign: 'center', padding: '60px 0' }}>
      <div style={s.spinner} />
      <div style={{ color: '#fff', fontWeight: 600, marginTop: 18 }}>
        {jobInfo?.status === 'queued' ? 'Waiting for another job to finish…' : 'Downloading and writing the caption…'}
      </div>
      <div style={{ color: '#666', fontSize: 13, marginTop: 6 }}>{jobInfo?.elapsed_s ? `${jobInfo.elapsed_s}s` : ''}</div>
      <style>{`@keyframes mspin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  // ── DONE (per-account results) ─────────────────────────────────────────────
  if (step === STEP.DONE) {
    const left = results.filter(r => r.state === 'sending' || r.state === 'publishing').length;
    return (
      <div>
        <h2 style={s.h2}>{left ? 'Posting…' : 'Finished'}</h2>
        <p style={s.sub}>{status || (left ? 'Instagram is still processing some reels.' : 'Check Posts for links.')}</p>
        <div style={s.card} className="glass">
          {results.map(r => (
            <div key={r.accountId} style={s.resRow}>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: '#fff', fontWeight: 600, fontSize: 14 }}>{r.name || r.username}</div>
                {r.username && <div style={{ color: '#666', fontSize: 12 }}>@{r.username}</div>}
                {r.state === 'failed' && <div style={{ color: '#ff7070', fontSize: 12, marginTop: 4 }}>{r.error}</div>}
              </div>
              <div style={{ ...s.badge, ...(r.state === 'posted' ? s.ok : r.state === 'failed' ? s.bad : s.wait) }}>
                {r.state === 'posted' ? 'Posted' : r.state === 'failed' ? 'Failed' : 'Sending…'}
              </div>
            </div>
          ))}
        </div>
        {!left && <button onClick={reset} className="shine" style={{ ...s.btn, ...s.primary }}>Post another clip</button>}
      </div>
    );
  }

  // ── REVIEW ─────────────────────────────────────────────────────────────────
  return (
    <div>
      <h2 style={s.h2}>Review</h2>

      {blocked && (
        <div style={s.err}>
          Safety check: this clip won’t be posted.{'\n'}{(guard.reasons || []).map(r => '• ' + r).join('\n')}
        </div>
      )}

      <div style={s.label}>Frame</div>
      {badPreview && badPreview === srcUrl && (
        <div style={{ ...s.err, marginBottom: 10 }}>Preview couldn’t load. Process the clip again.</div>
      )}
      <FrameEditor src={srcUrl} frame={frame} onChange={setFrame} autoFrame={autoFrame}
        cardImg={cardImg} cardH={cardH} canvasColor={canvasColor} onVideoError={() => setBadPreview(srcUrl)} />

      <div style={s.label}>On-screen text</div>
      <textarea id="multi-tos" name="tos" rows={2} style={s.input} value={onScreen} onChange={e => setOnScreen(e.target.value)}
        placeholder="Text shown above the video" />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        {['dark', 'light'].map(t => (
          <button key={t} type="button" onClick={() => setThemeSaved(t)}
            style={{ ...s.chip, ...(theme === t ? s.chipOn : {}) }}>{t === 'dark' ? 'Black background' : 'White background'}</button>
        ))}
      </div>

      <div style={s.label}>Caption</div>
      <textarea id="multi-caption" name="caption" rows={7} style={s.input} value={caption} onChange={e => setCaption(e.target.value)} />
      <RegenerateBar postId={result.postId} accountId={null} options={capOpts}
        onCaption={(c, h) => { setCaption(c || ''); if (h) setOnScreen(h); }} />
      <div style={{ height: 14 }} />
      <CaptionOptions value={capOpts} onChange={setCapOpts} />

      <div style={s.label}>
        Post to
        <button type="button" onClick={() => setPicked(allOn ? [] : accounts.map(a => a.id))} style={s.link}>
          {allOn ? 'Clear' : 'Select all'}
        </button>
      </div>
      <div style={s.card} className="glass">
        {accounts.length === 0 && <div style={{ color: '#666', fontSize: 13 }}>No connected accounts yet. Add one in Accounts.</div>}
        {accounts.map(a => {
          const on = picked.includes(a.id);
          return (
            <label key={a.id} style={s.acctRow}>
              <input type="checkbox" checked={on} onChange={() => toggle(a.id)} style={{ width: 20, height: 20, accentColor: '#e6356a' }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ color: '#fff', fontWeight: 600, fontSize: 14 }}>{a.name || a.username}</div>
                {a.username && <div style={{ color: '#666', fontSize: 12 }}>@{a.username}</div>}
              </div>
            </label>
          );
        })}
      </div>

      {error && <div style={s.err}>{error}</div>}
      {status && <div style={{ color: '#aaa', fontSize: 13, margin: '10px 0' }}>{status}</div>}

      <button onClick={handlePost} disabled={busy || !picked.length || blocked} className="shine"
        style={{ ...s.btn, ...s.primary, opacity: busy || !picked.length || blocked ? 0.4 : 1 }}>
        {busy ? 'Working…' : `Post to ${picked.length || ''} account${picked.length === 1 ? '' : 's'}`}
      </button>
      <button onClick={reset} disabled={busy} style={{ ...s.btn, background: '#151515', color: '#aaa', marginTop: 10 }}>Start over</button>
    </div>
  );
}

const s = {
  h2:      { color: '#fff', fontSize: 20, fontWeight: 700, margin: '4px 0 6px' },
  sub:     { color: '#777', fontSize: 13, margin: '0 0 16px', lineHeight: 1.45 },
  card:    { border: '1px solid #232323', borderRadius: 14, padding: 14, marginBottom: 16, background: '#0e0e0e' },
  label:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#888', fontSize: 12, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', margin: '18px 0 8px' },
  input:   { width: '100%', padding: '12px 14px', background: '#111', border: '1px solid #2a2a2a', borderRadius: 10, color: '#fff', fontSize: 15, lineHeight: 1.45, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical' },
  pickBtn: { width: '100%', padding: '16px 14px', background: '#151515', border: '1px dashed #3a3a3a', borderRadius: 12, color: '#ddd', fontSize: 15, fontWeight: 600, cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  or:      { textAlign: 'center', color: '#555', fontSize: 12, margin: '10px 0' },
  btn:     { width: '100%', padding: '15px 16px', border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: 'pointer' },
  primary: { background: 'linear-gradient(135deg,#833ab4,#fd1d1d)', color: '#fff' },
  err:     { background: 'rgba(255,80,80,0.1)', border: '1px solid rgba(255,80,80,0.3)', color: '#ff8a8a', borderRadius: 10, padding: '10px 12px', fontSize: 13, margin: '12px 0', whiteSpace: 'pre-wrap' },
  chip:    { flex: 1, padding: '10px 12px', background: '#151515', border: '1px solid #2a2a2a', color: '#aaa', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  chipOn:  { background: 'rgba(230,53,106,0.15)', borderColor: '#e6356a', color: '#fff' },
  link:    { background: 'none', border: 'none', color: '#e6356a', fontSize: 12, fontWeight: 700, cursor: 'pointer', textTransform: 'none', letterSpacing: 0 },
  acctRow: { display: 'flex', alignItems: 'center', gap: 12, padding: '10px 2px', cursor: 'pointer' },
  resRow:  { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '10px 0', borderBottom: '1px solid #1c1c1c' },
  badge:   { fontSize: 12, fontWeight: 700, padding: '4px 10px', borderRadius: 999, whiteSpace: 'nowrap' },
  ok:      { background: 'rgba(52,211,153,0.12)', color: '#34d399' },
  bad:     { background: 'rgba(255,80,80,0.12)', color: '#ff7070' },
  wait:    { background: 'rgba(255,255,255,0.08)', color: '#bbb' },
  spinner: { width: 36, height: 36, margin: '0 auto', border: '3px solid rgba(255,255,255,0.1)', borderTop: '3px solid #e6356a', borderRadius: '50%', animation: 'mspin 0.8s linear infinite' },
};
