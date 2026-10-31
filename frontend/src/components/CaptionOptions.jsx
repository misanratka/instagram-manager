import React, { useMemo } from 'react';
import { api } from '../services/api';
import { useState } from 'react';

// ONE place to describe the post. Write it like you'd tell a person:
//   Funny caption, ask who they'd pick. Add the line "Link in bio for the full video".
//   Tag @brand, use #ad #movies. On screen: MOVIE10 for 10% off
// The server sorts it out: exact lines stay word-for-word, @tags and #hashtags are used exactly, nothing is invented.
// value shape: { brief }
const MAX = 1500;
const EXAMPLES = [
  ['Tone', 'Funny caption, ask who they’d pick'],
  ['Exact line', 'Add the line "Link in bio for the full video"'],
  ['On screen', 'On screen: Use code MOVIE10 🎬'],
  ['Tags', 'Tag @brand and use #ad #movies'],
];

export default function CaptionOptions({ value, onChange }) {
  const brief = value.brief || '';
  const found = useMemo(() => {
    const at = [...new Set(brief.match(/@[A-Za-z0-9._]{2,30}/g) || [])];
    const tags = [...new Set(brief.match(/#[\p{L}\p{N}_]{1,50}/gu) || [])];
    const quoted = (brief.match(/["“][^"”]{2,}["”]/g) || []).length;
    const tos = /on[- ]?screen|overlay|\btos\b|text on/i.test(brief);
    return { at, tags, quoted, tos };
  }, [brief]);

  const add = (txt) => onChange({ ...value, brief: (brief ? brief.replace(/\s+$/, '') + '\n' : '') + txt });
  const chips = [
    found.at.length   && `${found.at.length} tag${found.at.length > 1 ? 's' : ''}`,
    found.tags.length && `${found.tags.length} hashtag${found.tags.length > 1 ? 's' : ''}`,
    found.quoted      && `${found.quoted} exact line${found.quoted > 1 ? 's' : ''}`,
    found.tos         && 'on-screen text',
  ].filter(Boolean);

  return (
    <div style={st.wrap} className="glass">
      <div style={st.head}>
        <span style={st.title}>Describe this post</span>
        <span style={st.count}>{brief.length}/{MAX}</span>
      </div>

      <textarea id="cap-brief" name="brief" rows={5} maxLength={MAX} style={st.input} value={brief}
        onChange={e => onChange({ ...value, brief: e.target.value })}
        placeholder={'Write it the way you’d tell a person. Optional.\n\nFunny caption, ask who they’d pick. Add the line "Link in bio for the full video". Tag @brand, use #ad #movies. On screen: MOVIE10 for 10% off'} />

      <div style={st.row}>
        {chips.length === 0
          ? <span style={st.hint}>Leave empty and the AI writes everything. Hashtags are only added if you ask.</span>
          : chips.map(c => <span key={c} style={st.chip}>✓ {c}</span>)}
      </div>

      <div style={st.row}>
        {EXAMPLES.map(([label, txt]) => (
          <button key={label} type="button" onClick={() => add(txt)} style={st.ex}>+ {label}</button>
        ))}
      </div>
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
      onCaption(res.generatedCaption || '', res.hookText || '', !!res.tosLocked);
      setTweak('');
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input id="cap-tweak" name="tweak" style={{ ...st.input, flex: 1, resize: 'none' }} value={tweak} disabled={busy}
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

const st = {
  wrap:     { border: '1px solid #232323', borderRadius: 14, marginBottom: 16, background: '#0e0e0e', padding: 14 },
  head:     { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 },
  title:    { fontSize: 14, fontWeight: 700, color: '#e5e5e5' },
  count:    { fontSize: 11, color: '#4a4a4a' },
  input:    { width: '100%', padding: '12px 14px', background: '#111', border: '1px solid #2a2a2a', borderRadius: 10, color: '#fff', fontSize: 15, lineHeight: 1.45, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', resize: 'vertical' },
  row:      { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10, alignItems: 'center' },
  hint:     { fontSize: 12, color: '#555' },
  chip:     { background: 'rgba(52,211,153,0.12)', color: '#34d399', borderRadius: 999, padding: '3px 10px', fontSize: 12, fontWeight: 600 },
  ex:       { background: '#151515', border: '1px solid #2a2a2a', color: '#aaa', borderRadius: 999, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  regenBtn: { padding: '0 16px', background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, color: '#ccc', fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' },
};
