import React, { useRef, useState } from 'react';

// Same numbers as backend/services/brandCard.js → computeLayout(). Keep them in sync.
const CANVAS_W = 1080, CANVAS_H = 1920, MARGIN = 64, CONTENT_W = CANVAS_W - MARGIN * 2;
const SAFE_TOP = 110, SAFE_BOTTOM = 170;
const PREVIEW_W = 280;

function computeLayout(cardH, srcW, srcH, offsetY) {
  const GAP = cardH > 0 ? 24 : 0;
  const availH = CANVAS_H - SAFE_TOP - SAFE_BOTTOM - cardH - GAP;
  const s = Math.min(CONTENT_W / srcW, availH / srcH);
  const vidW = srcW * s, vidH = srcH * s;
  const groupH = cardH + GAP + vidH;
  const centred = Math.round((CANVAS_H - groupH) / 2) + (offsetY || 0);
  const top = Math.min(Math.max(40, centred), CANVAS_H - groupH - 40);
  return { cardX: MARGIN, cardY: top, vidW, vidH, vidX: MARGIN + (CONTENT_W - vidW) / 2, vidY: top + cardH + GAP };
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const fmt = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

/**
 * frame = { top, bottom, left, right (0..1 of the original frame), zoom (1..2), offsetY (px), cardScale (0.8..1.4) }
 */
export default function FrameEditor({ src, frame, onChange, autoFrame, cardImg, cardH, canvasColor, onVideoError }) {
  const vref = useRef(null);
  const boxRef = useRef(null);
  const drag = useRef(null);
  const [nat, setNat] = useState({ w: 0, h: 0 });
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [dur, setDur] = useState(0);

  const set = (patch) => onChange({ ...frame, ...patch });

  // ── dragging the TOP / BOTTOM handles ──────────────────────────────────────
  const startDrag = (which) => (e) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = which;
  };
  const onMove = (e) => {
    if (!drag.current || !boxRef.current) return;
    const r = boxRef.current.getBoundingClientRect();
    const y = clamp((e.clientY - r.top) / r.height, 0, 1);
    if (drag.current === 'top') set({ top: Math.min(y, frame.bottom - 0.08) });
    else set({ bottom: Math.max(y, frame.top + 0.08) });
  };
  const endDrag = () => { drag.current = null; };

  const togglePlay = () => {
    const v = vref.current; if (!v) return;
    if (v.paused) { v.play().catch(() => {}); } else { v.pause(); }
  };
  const seek = (val) => { if (vref.current) vref.current.currentTime = val; setT(val); };

  const reset = () => onChange({ ...(autoFrame || { top: 0, bottom: 1, left: 0, right: 1 }), zoom: 1, offsetY: 0, cardScale: 1 });
  const fullFrame = () => onChange({ top: 0, bottom: 1, left: 0, right: 1, zoom: 1, offsetY: frame.offsetY, cardScale: frame.cardScale });

  // ── live preview of the final 1080x1920 layout ─────────────────────────────
  let preview = null;
  if (nat.w && nat.h && cardH !== null && cardH !== undefined) {
    const W = nat.w, H = nat.h;
    const x0 = frame.left * W, y0 = frame.top * H;
    const w0 = (frame.right - frame.left) * W, h0 = (frame.bottom - frame.top) * H;
    const z = frame.zoom || 1;
    const rw = w0 / z, rh = h0 / z;
    const rx = x0 + (w0 - rw) / 2, ry = y0 + (h0 - rh) / 2;
    const L = computeLayout(cardH, rw, rh, frame.offsetY);
    const f = PREVIEW_W / CANVAS_W;
    const k = (L.vidW * f) / rw;
    preview = (
      <div style={{ position: 'relative', width: PREVIEW_W, height: CANVAS_H * f, background: canvasColor || '#000', borderRadius: 12, overflow: 'hidden', margin: '0 auto', border: '1px solid #222' }}>
        {cardImg && <img src={cardImg} alt="" style={{ position: 'absolute', left: L.cardX * f, top: L.cardY * f, width: CONTENT_W * f, height: cardH * f }} />}
        <div style={{ position: 'absolute', left: L.vidX * f, top: L.vidY * f, width: L.vidW * f, height: L.vidH * f, overflow: 'hidden', background: '#000' }}>
          <video src={src} autoPlay muted loop playsInline
            style={{ position: 'absolute', left: -rx * k, top: -ry * k, width: W * k, height: H * k, maxWidth: 'none' }} />
        </div>
      </div>
    );
  }

  const pct = (v) => `${(v * 100).toFixed(2)}%`;

  return (
    <div>
      {/* Source video with draggable crop edges */}
      {/* width is capped from the video's shape so the box height always equals the picture height (handle % = picture %) */}
      <div style={{ width: '100%', maxWidth: nat.w && nat.h ? Math.max(200, 520 * (nat.w / nat.h)) : '100%', margin: '0 auto' }}>
      <div ref={boxRef} style={{ position: 'relative', background: '#000', borderRadius: 8, overflow: 'hidden', touchAction: 'none', userSelect: 'none' }}>
        <video ref={vref} src={src} muted playsInline preload="metadata"
          onLoadedMetadata={e => { setNat({ w: e.target.videoWidth, h: e.target.videoHeight }); setDur(e.target.duration || 0); }}
          onTimeUpdate={e => setT(e.target.currentTime)}
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
          onError={onVideoError}
          style={{ width: '100%', display: 'block' }} />
        {/* dimmed areas that will be cut */}
        <div style={{ ...st.dim, top: 0, left: 0, right: 0, height: pct(frame.top) }} />
        <div style={{ ...st.dim, bottom: 0, left: 0, right: 0, height: pct(1 - frame.bottom) }} />
        {frame.left > 0.001 && <div style={{ ...st.dim, top: pct(frame.top), bottom: pct(1 - frame.bottom), left: 0, width: pct(frame.left) }} />}
        {frame.right < 0.999 && <div style={{ ...st.dim, top: pct(frame.top), bottom: pct(1 - frame.bottom), right: 0, width: pct(1 - frame.right) }} />}
        {/* handles */}
        {[['top', frame.top, 'TOP'], ['bottom', frame.bottom, 'BOTTOM']].map(([key, val, label]) => (
          <div key={key}
            onPointerDown={startDrag(key)} onPointerMove={onMove} onPointerUp={endDrag} onPointerCancel={endDrag}
            style={{ position: 'absolute', left: 0, right: 0, top: pct(val), height: 44, transform: 'translateY(-50%)', cursor: 'ns-resize', display: 'flex', alignItems: 'center', justifyContent: 'center', touchAction: 'none' }}>
            <div style={{ position: 'absolute', left: 0, right: 0, height: 2, background: '#7b6fff' }} />
            <div style={st.pill}>{label}</div>
          </div>
        ))}
      </div>
      </div>

      {/* transport */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
        <button type="button" onClick={togglePlay} style={st.playBtn}>{playing ? 'Pause' : 'Play'}</button>
        <input type="range" min={0} max={dur || 1} step={0.05} value={t} onChange={e => seek(Number(e.target.value))} style={{ flex: 1, accentColor: '#7b6fff' }} />
        <span style={{ fontSize: 11, color: '#666', fontVariantNumeric: 'tabular-nums' }}>{fmt(t)} / {fmt(dur)}</span>
      </div>
      <div style={{ fontSize: 11, color: '#555', marginTop: 8 }}>
        Drag TOP and BOTTOM to cut black bars or old text out of the clip.{autoFrame ? ' Black bars were trimmed automatically.' : ''}
      </div>

      {/* sliders */}
      <Slider label="Zoom" value={frame.zoom} min={1} max={2} step={0.01} onChange={v => set({ zoom: v })} show={v => `${Math.round(v * 100)}%`} />
      <Slider label="Card position" value={frame.offsetY} min={-400} max={400} step={5} onChange={v => set({ offsetY: v })} show={v => (v === 0 ? 'Centered' : v < 0 ? `Higher ${-v}` : `Lower ${v}`)} />
      <Slider label="Card size" value={frame.cardScale} min={0.8} max={1.4} step={0.05} onChange={v => set({ cardScale: v })} show={v => `${Math.round(v * 100)}%`} />
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <button type="button" onClick={reset} style={st.ghostBtn}>Reset framing</button>
        <button type="button" onClick={fullFrame} style={st.ghostBtn}>Use full frame</button>
      </div>

      {/* live preview */}
      <div style={{ fontSize: 11, fontWeight: 700, color: '#666', textTransform: 'uppercase', letterSpacing: '0.5px', margin: '20px 0 10px' }}>Live preview</div>
      {preview || <div style={{ color: '#444', fontSize: 12 }}>Loading preview…</div>}
    </div>
  );
}

function Slider({ label, value, min, max, step, onChange, show }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#999', marginBottom: 4 }}>
        <span>{label}</span><span style={{ color: '#7b6fff', fontVariantNumeric: 'tabular-nums' }}>{show(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(Number(e.target.value))} style={{ width: '100%', accentColor: '#7b6fff' }} />
    </div>
  );
}

const st = {
  dim:      { position: 'absolute', background: 'rgba(0,0,0,0.68)', pointerEvents: 'none' },
  pill:     { position: 'relative', background: '#7b6fff', color: '#fff', fontSize: 10, fontWeight: 800, letterSpacing: '0.6px', padding: '4px 12px', borderRadius: 999 },
  playBtn:  { padding: '8px 18px', background: '#7b6fff', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', minWidth: 70 },
  ghostBtn: { flex: 1, padding: '9px 12px', background: '#111', border: '1px solid #2a2a2a', borderRadius: 8, color: '#bbb', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
};
