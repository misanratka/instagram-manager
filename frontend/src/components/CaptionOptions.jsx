import React, { useState } from 'react';
import { api } from '../services/api';

// Optional per-post caption controls. Collapsed by default so the normal flow stays one click.
// value shape: { instructions, mustInclude, mentions, hashtags, aiHashtags, creditLine }
export default function CaptionOptions({ value, onChange, isFile }) {
  const [open, setOpen] = useState(false);
  const set = (k, v) => onChange({ ...value, [k]: v });
  const creditOn = typeof value.creditLine === 'boolean' ? value.creditLine : !isFile; // auto: on for links, off for own clips
  const filled = ['instructions', 'mustInclude', 'mentions', 'hashtags', 'tosExact', 'tosMustInclude'].filter(k => value[k]?.trim()).length + (value.aiHashtags ? 1 : 0);

  return (
    <div style={st.wrap}>
      <button type="button" onClick={() => setOpen(o => !o)} style={st.head}>
        <span>Caption options <span style={st.opt}>(optional)</span></span>
        <span style={st.right}>{filled > 0 && <span style={st.badge}>{filled} set</span>}{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div style={st.body} className="expand">
          <Field label="Instructions for this post" hint="Anything you want the caption to focus on or avoid.">
            <textarea id="cap-instructions" name="instructions" rows={2} style={st.input} value={value.instructions || ''}
              onChange={e => set('instructions', e.target.value)} placeholder="e.g. mention it's out Friday, keep it funny, ask people to pick their favorite" />
          </Field>

          <Field label="Exact phrase to include" hint="Added word-for-word. One phrase per line.">
            <textarea id="cap-must-include" name="must_include" rows={2} style={st.input} value={value.mustInclude || ''}
              onChange={e => set('mustInclude', e.target.value)} placeholder="e.g. Link in bio for the full video" />
          </Field>

          <Field label="Exact on-screen text (TOS)" hint="Use this as the on-screen text exactly. Leave empty to let AI write it. Good for campaign lines.">
            <textarea id="cap-tos-exact" name="tos_exact" rows={2} style={st.input} value={value.tosExact || ''}
              onChange={e => set('tosExact', e.target.value)} placeholder="e.g. Ad: Use code MOVIE10 for 10% off 🎬" />
          </Field>

          <Field label="Must appear in the on-screen text" hint="AI writes the TOS but must include these words or lines exactly. Ignored if exact text is set. One per line.">
            <textarea id="cap-tos-must" name="tos_must_include" rows={2} style={st.input} value={value.tosMustInclude || ''}
              onChange={e => set('tosMustInclude', e.target.value)} placeholder="e.g. Sponsored by @brand" />
          </Field>

          <Field label="Tag accounts" hint="Separate with spaces or commas.">
            <input id="cap-mentions" name="mentions" style={st.input} value={value.mentions || ''}
              onChange={e => set('mentions', e.target.value)} placeholder="@account1 @account2" />
          </Field>

          <Field label="Hashtags" hint="None are added unless you type them or turn on AI suggestions.">
            <input id="cap-hashtags" name="hashtags" style={st.input} value={value.hashtags || ''}
              onChange={e => set('hashtags', e.target.value)} placeholder="#movies #trailer" />
            <Check checked={!!value.aiHashtags} onChange={v => set('aiHashtags', v)} label="Let AI suggest hashtags too" id="cap-ai-hashtags" />
          </Field>

          <Check checked={creditOn} onChange={v => set('creditLine', v)} id="cap-credit"
            label={`Add "Credits — DM for removal." line`} />
          <div style={st.hint}>{isFile ? 'Off by default for your own clips.' : 'On by default for links.'}</div>
        </div>
      )}
    </div>
  );
}

// Shown under the caption box in the review step: rewrite the caption without reprocessing the video.
export function RegenerateBar({ postId, accountId, options, onCaption }) {
  const [tweak, setTweak] = useState('');
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState('');

  async function run() {
    setBusy(true); setErr('');
    try {
      const res = await api.regenerateCaption(postId, accountId, { ...options, tweak });
      onCaption(res.generatedCaption || '', res.hookText || '');
      setTweak('');
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input id="cap-tweak" name="tweak" style={{ ...st.input, flex: 1 }} value={tweak} disabled={busy}
          onChange={e => setTweak(e.target.value)} onKeyDown={e => e.key === 'Enter' && !busy && run()}
          placeholder="Rewrite with a tweak, e.g. make it shorter (optional)" />
        <button type="button" onClick={run} disabled={busy} style={{ ...st.regenBtn, opacity: busy ? 0.5 : 1 }}>
          {busy ? 'Writing…' : '↻ Regenerate'}
        </button>
      </div>
      {err && <div style={{ color: '#ff7070', fontSize: 12, marginTop: 6 }}>{err}</div>}
    </div>
  );
}

function Field({ label, hint, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={st.label}>{label}</div>
      {children}
      {hint && <div style={st.hint}>{hint}</div>}
    </div>
  );
}

function Check({ checked, onChange, label, id }) {
  return (
    <label htmlFor={id} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, cursor: 'pointer', fontSize: 13, color: '#bbb' }}>
      <input id={id} name={id} type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} style={{ accentColor: '#833ab4', width: 16, height: 16 }} />
      {label}
    </label>
  );
}

const st = {
  wrap:     { border: '1px solid #1c1c1c', borderRadius: 10, marginBottom: 16, background: '#0e0e0e' },
  head:     { width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 14px', background: 'transparent', border: 'none', color: '#ccc', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
  opt:      { color: '#555', fontWeight: 400, fontSize: 12 },
  right:    { display: 'flex', alignItems: 'center', gap: 10, color: '#555', fontSize: 11 },
  badge:    { background: 'rgba(168,85,247,0.15)', color: '#c084fc', borderRadius: 10, padding: '2px 8px', fontSize: 11, fontWeight: 600 },
  body:     { padding: '4px 14px 14px' },
  label:    { fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 },
  hint:     { fontSize: 11, color: '#444', marginTop: 5 },
  input:    { width: '100%', padding: '10px 12px', background: '#111', border: '1px solid #252525', borderRadius: 8, color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical' },
  regenBtn: { padding: '0 16px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, color: '#ccc', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' },
};
