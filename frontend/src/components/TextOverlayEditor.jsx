import React, { useState, useEffect, useRef } from 'react';

function bgFill(bg) {
  if (bg === 'black') return '#000000';
  if (bg === 'white') return '#ffffff';
  if (bg === 'dark')  return 'rgba(0,0,0,0.78)';
  if (bg === 'light') return 'rgba(255,255,255,0.82)';
  return 'transparent';
}

function textColorFor(box) {
  if (box.bg === 'black' || box.bg === 'dark')  return '#ffffff';
  if (box.bg === 'white' || box.bg === 'light') return '#111111';
  return box.colorHex || '#ffffff';
}

function isCover(box) {
  return !box.text.trim() && box.bg !== 'none';
}

function boxStyle(box, isActive) {
  const cover = isCover(box);
  const base = {
    position: 'absolute',
    left: box.xPct + '%',
    top:  box.yPct + '%',
    transform: 'translate(-50%,-50%)',
    touchAction: 'none',
    userSelect: 'none',
    cursor: 'grab',
    borderRadius: 10,
    outline: isActive ? '2px solid rgba(123,111,255,0.9)' : 'none',
    pointerEvents: 'all',
  };
  if (cover) {
    return {
      ...base,
      width:  (box.coverWidthPct  || 65) + '%',
      height: (box.coverHeightPct || 14) + '%',
      minWidth: 40, minHeight: 18,
      background: bgFill(box.bg),
      boxShadow: isActive
        ? '0 0 0 1px rgba(255,255,255,0.2), 0 4px 20px rgba(0,0,0,0.5)'
        : '0 2px 14px rgba(0,0,0,0.5)',
    };
  }
  return {
    ...base,
    fontSize: (box.fontSize || 32) + 'px',
    fontWeight: 800,
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    lineHeight: 1.2,
    letterSpacing: '-0.01em',
    textAlign: box.align || 'center',
    width: (box.widthPct || 80) + '%',
    maxWidth: '92%',
    padding: '6px 14px',
    background: box.bg !== 'none' ? bgFill(box.bg) : 'transparent',
    color: textColorFor(box),
    textShadow: box.bg === 'none'
      ? '0 2px 8px rgba(0,0,0,1), 0 0 2px rgba(0,0,0,1), 1px 1px 0 rgba(0,0,0,0.8)'
      : 'none',
    boxShadow: isActive ? '0 0 0 1px rgba(255,255,255,0.15)' : 'none',
  };
}

const CORNERS = [
  { key: 'nw', style: { top: -14, left: -14 } },
  { key: 'ne', style: { top: -14, right: -14 } },
  { key: 'se', style: { bottom: -14, right: -14 } },
  { key: 'sw', style: { bottom: -14, left: -14 } },
];

function Handles({ boxId, onPointerDown }) {
  return (
    <>
      {CORNERS.map(({ key, style }) => (
        <div
          key={key}
          onPointerDown={e => onPointerDown(e, boxId, key)}
          style={{
            position: 'absolute',
            width: 28, height: 28,
            borderRadius: '50%',
            background: '#7b6fff',
            border: '2.5px solid #fff',
            boxShadow: '0 2px 10px rgba(0,0,0,0.6)',
            touchAction: 'none',
            cursor: 'nwse-resize',
            zIndex: 20,
            ...style,
          }}
        />
      ))}
    </>
  );
}

const COLORS  = ['#ffffff', '#ffff00', '#ff8800', '#ff3333', '#00ffff', '#111111'];
const BG_OPTS = ['none', 'dark', 'black', 'light', 'white'];

function TextPanel({ box, onUpdate, onRemove }) {
  const align = box.align || 'center';
  const size  = box.fontSize || 32;
  return (
    <>
      <div style={{ display: 'flex', gap: 6, marginBottom: 9, alignItems: 'center' }}>
        {['left', 'center', 'right'].map(a => (
          <button key={a} onClick={() => onUpdate({ align: a })} style={{
            padding: '6px 11px', borderRadius: 7, cursor: 'pointer', fontSize: 13, fontWeight: 700,
            background: align === a ? '#1e1e40' : '#141420',
            border: align === a ? '2px solid #7b6fff' : '1.5px solid #2a2a3a',
            color: align === a ? '#fff' : '#666',
          }}>
            {a === 'left' ? '≡L' : a === 'center' ? '≡C' : '≡R'}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={() => onUpdate({ fontSize: Math.max(12, size - 4) })} style={S.iconBtn}>−</button>
        <span style={{ fontSize: 12, color: '#999', minWidth: 26, textAlign: 'center' }}>{size}</span>
        <button onClick={() => onUpdate({ fontSize: Math.min(200, size + 4) })} style={S.iconBtn}>+</button>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 9 }}>
        <textarea
          autoFocus
          value={box.text}
          onChange={e => onUpdate({ text: e.target.value })}
          placeholder="Type text…  (Enter = new line)"
          rows={3}
          style={{
            flex: 1, minHeight: 72, padding: '10px 12px',
            background: '#141420', border: '1.5px solid #3a3a5a',
            borderRadius: 10, color: '#fff', fontSize: 15,
            outline: 'none', resize: 'none', fontFamily: 'inherit', lineHeight: 1.5,
          }}
        />
        <button onClick={onRemove} style={{
          padding: '10px', background: '#1a0808', border: '1px solid #4a1a1a',
          borderRadius: 10, color: '#ff6060', cursor: 'pointer', fontSize: 12, fontWeight: 700,
        }}>Del</button>
      </div>

      <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: '#555', marginRight: 2 }}>BG</span>
        {BG_OPTS.map(bg => (
          <button key={bg} onClick={() => onUpdate({ bg })} style={{
            padding: '5px 10px', borderRadius: 7, cursor: 'pointer', fontSize: 12,
            background: box.bg === bg ? '#1e1e40' : '#141420',
            border: box.bg === bg ? '2px solid #7b6fff' : '1.5px solid #2a2a3a',
            color: box.bg === bg ? '#fff' : '#777',
          }}>{bg}</button>
        ))}
        {box.bg === 'none' && (
          <>
            <div style={{ width: 1, height: 22, background: '#2a2a3a', margin: '0 3px' }} />
            {COLORS.map(hex => (
              <button key={hex} onClick={() => onUpdate({ colorHex: hex })} style={{
                width: 26, height: 26, borderRadius: '50%', background: hex,
                cursor: 'pointer', flexShrink: 0,
                border: box.colorHex === hex ? '2.5px solid #fff' : '1.5px solid #444',
              }} />
            ))}
          </>
        )}
      </div>
    </>
  );
}

function CoverPanel({ box, onUpdate, onRemove }) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
        <span style={{ fontSize: 12, color: '#888', fontWeight: 600 }}>Cover Block</span>
        <span style={{ fontSize: 11, color: '#444' }}>drag or use corner handles</span>
        <button onClick={onRemove} style={{
          marginLeft: 'auto', padding: '6px 12px', background: '#1a0808',
          border: '1px solid #4a1a1a', borderRadius: 7, color: '#ff6060', cursor: 'pointer', fontSize: 12, fontWeight: 600,
        }}>Remove</button>
      </div>
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 9 }}>
        <span style={{ fontSize: 11, color: '#555' }}>Style</span>
        {BG_OPTS.filter(b => b !== 'none').map(bg => (
          <button key={bg} onClick={() => onUpdate({ bg })} style={{
            padding: '5px 11px', borderRadius: 7, cursor: 'pointer', fontSize: 12,
            background: box.bg === bg ? '#1e1e40' : '#141420',
            border: box.bg === bg ? '2px solid #7b6fff' : '1.5px solid #2a2a3a',
            color: box.bg === bg ? '#fff' : '#777',
          }}>{bg}</button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 16 }}>
        {[
          { label: 'W', key: 'coverWidthPct',  def: 65, step: 5, min: 18, max: 95 },
          { label: 'H', key: 'coverHeightPct', def: 14, step: 2, min: 6,  max: 70 },
        ].map(({ label, key, def, step, min, max }) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: '#555' }}>{label}</span>
            <button onClick={() => onUpdate({ [key]: Math.max(min, (box[key] || def) - step) })} style={S.iconBtn}>−</button>
            <span style={{ fontSize: 12, color: '#ccc', minWidth: 34, textAlign: 'center' }}>{Math.round(box[key] || def)}%</span>
            <button onClick={() => onUpdate({ [key]: Math.min(max, (box[key] || def) + step) })} style={S.iconBtn}>+</button>
          </div>
        ))}
      </div>
    </>
  );
}

export default function TextOverlayEditor({ videoSrc, textBoxes, onChange, onClose }) {
  const containerRef = useRef(null);
  const videoRef     = useRef(null);
  const boxesRef     = useRef(textBoxes);
  const gestureRef   = useRef(null);
  const ptrsRef      = useRef(new Map());
  const [selectedId, setSelectedId] = useState(null);
  const [playing, setPlaying]       = useState(false);

  useEffect(() => { boxesRef.current = textBoxes; }, [textBoxes]);

  const sel = textBoxes.find(b => b.id === selectedId) ?? null;

  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setPlaying(true); }
    else          { v.pause(); setPlaying(false); }
  }

  function createBox(overrides = {}) {
    const id = Date.now();
    const box = {
      id, text: '', xPct: 50, yPct: 45,
      colorHex: '#ffffff', color: 'white',
      fontSize: 32, size: 'large', bg: 'none',
      align: 'center', widthPct: 80,
      coverWidthPct: 65, coverHeightPct: 14,
      startTime: 0, endTime: 0,
      ...overrides,
    };
    onChange(prev => [...prev, box]);
    setSelectedId(id);
  }

  function removeBox(id) {
    onChange(prev => prev.filter(b => b.id !== id));
    setSelectedId(null);
  }

  function updateBox(id, patch) {
    onChange(prev => prev.map(b => b.id === id ? { ...b, ...patch } : b));
  }

  function onBoxPointerDown(e, id) {
    e.preventDefault();
    e.stopPropagation();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
    setSelectedId(id);
    ptrsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY, boxId: id });

    const peers = [...ptrsRef.current.values()].filter(p => p.boxId === id);
    if (peers.length >= 2) {
      const dist = Math.hypot(peers[0].x - peers[1].x, peers[0].y - peers[1].y);
      const box  = boxesRef.current.find(b => b.id === id);
      gestureRef.current = { mode: 'pinch', id, startDist: dist, startFontSize: box?.fontSize || 32 };
    } else {
      const rect = containerRef.current?.getBoundingClientRect();
      const box  = boxesRef.current.find(b => b.id === id);
      if (!rect || !box) return;
      gestureRef.current = {
        mode: 'drag', id,
        offsetX: e.clientX - rect.left - (box.xPct / 100) * rect.width,
        offsetY: e.clientY - rect.top  - (box.yPct / 100) * rect.height,
      };
    }
  }

  function onHandlePointerDown(e, id, corner) {
    e.preventDefault();
    e.stopPropagation();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
    ptrsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY, boxId: id });
    const box = boxesRef.current.find(b => b.id === id);
    if (!box) return;
    gestureRef.current = {
      mode: 'corner', id, corner,
      startX: e.clientX, startY: e.clientY,
      isBoxCover: isCover(box),
      startFontSize: box.fontSize || 32,
      startCW: box.coverWidthPct  || 65,
      startCH: box.coverHeightPct || 14,
    };
  }

  useEffect(() => {
    function onMove(e) {
      const ptr = ptrsRef.current.get(e.pointerId);
      if (ptr) { ptr.x = e.clientX; ptr.y = e.clientY; }

      const g = gestureRef.current;
      if (!g) return;

      if (g.mode === 'drag') {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        onChange(prev => prev.map(b => b.id === g.id ? {
          ...b,
          xPct: Math.max(2, Math.min(98, ((e.clientX - rect.left - g.offsetX) / rect.width)  * 100)),
          yPct: Math.max(2, Math.min(98, ((e.clientY - rect.top  - g.offsetY) / rect.height) * 100)),
        } : b));

      } else if (g.mode === 'pinch') {
        const pts = [...ptrsRef.current.values()].filter(p => p.boxId === g.id);
        if (pts.length < 2) return;
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        onChange(prev => prev.map(b => b.id === g.id ? {
          ...b, fontSize: Math.max(12, Math.min(200, Math.round(g.startFontSize * dist / g.startDist))),
        } : b));

      } else if (g.mode === 'corner') {
        const dx = e.clientX - g.startX;
        const dy = e.clientY - g.startY;
        if (g.isBoxCover) {
          const rect = containerRef.current?.getBoundingClientRect();
          if (!rect) return;
          const dw = (g.corner === 'se' || g.corner === 'ne') ?  dx : -dx;
          const dh = (g.corner === 'se' || g.corner === 'sw') ?  dy : -dy;
          onChange(prev => prev.map(b => b.id === g.id ? {
            ...b,
            coverWidthPct:  Math.max(18, Math.min(95, g.startCW + (dw / rect.width)  * 100)),
            coverHeightPct: Math.max(6,  Math.min(70, g.startCH + (dh / rect.height) * 100)),
          } : b));
        } else {
          const outward = g.corner === 'se' ?  (dx + dy) / 2
                        : g.corner === 'nw' ? -(dx + dy) / 2
                        : g.corner === 'ne' ?  (dx - dy) / 2
                        :                     -(dx - dy) / 2;
          onChange(prev => prev.map(b => b.id === g.id ? {
            ...b, fontSize: Math.max(12, Math.min(200, Math.round(g.startFontSize + outward * 0.25))),
          } : b));
        }
      }
    }

    function onUp(e) {
      ptrsRef.current.delete(e.pointerId);
      if (ptrsRef.current.size === 0) gestureRef.current = null;
    }

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerup',     onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup',   onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [onChange]);

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#000', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', background: '#111', borderBottom: '1px solid #222', flexShrink: 0 }}>
        <button onClick={onClose} style={S.btnPrimary}>Done</button>
        <div style={{ display: 'flex', gap: 8 }}>
          {videoSrc && <button onClick={togglePlay} style={S.btnGhost}>{playing ? '⏸' : '▶'}</button>}
          <button onClick={() => createBox({ bg: 'dark', fontSize: 44, coverWidthPct: 70, coverHeightPct: 15 })} style={S.btnGhost}>Cover</button>
          <button onClick={() => createBox()} style={S.btnSecondary}>+ Text</button>
        </div>
      </div>

      <div
        ref={containerRef}
        style={{ flex: 1, position: 'relative', overflow: 'hidden', touchAction: 'none', background: '#000' }}
        onClick={() => setSelectedId(null)}
      >
        {videoSrc
          ? <video ref={videoRef} src={videoSrc} loop playsInline style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block', pointerEvents: 'none' }} />
          : <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', color: '#555', fontSize: 14 }}>No video preview</div>
        }
        {textBoxes.map(box => {
          const isActive = box.id === selectedId;
          return (
            <div
              key={box.id}
              style={boxStyle(box, isActive)}
              onPointerDown={e => onBoxPointerDown(e, box.id)}
            >
              {!isCover(box) && (
                box.text || <span style={{ opacity: 0.4, fontWeight: 400, fontSize: '0.75em' }}>tap to edit</span>
              )}
              {isActive && <Handles boxId={box.id} onPointerDown={onHandlePointerDown} />}
            </div>
          );
        })}
      </div>

      {sel ? (
        <div style={{ background: '#0a0a12', borderTop: '1.5px solid #1e1e3a', padding: '12px 14px', flexShrink: 0 }} onClick={e => e.stopPropagation()}>
          {isCover(sel)
            ? <CoverPanel box={sel} onUpdate={p => updateBox(sel.id, p)} onRemove={() => removeBox(sel.id)} />
            : <TextPanel  box={sel} onUpdate={p => updateBox(sel.id, p)} onRemove={() => removeBox(sel.id)} />
          }
        </div>
      ) : textBoxes.length === 0 ? (
        <div style={{ padding: 14, textAlign: 'center', color: '#555', fontSize: 13, flexShrink: 0 }}>
          Tap "+ Text" to add text on the video
        </div>
      ) : null}
    </div>
  );
}

const S = {
  btnPrimary:   { background: 'linear-gradient(135deg,#833ab4,#fd1d1d)', border: 'none', borderRadius: 8, color: '#fff', padding: '8px 18px', fontWeight: 700, cursor: 'pointer', fontSize: 14 },
  btnSecondary: { background: '#1a1a2e', border: '1px solid #444', borderRadius: 8, color: '#ccc', padding: '8px 16px', fontWeight: 600, cursor: 'pointer', fontSize: 14 },
  btnGhost:     { background: '#1a1a1a', border: '1px solid #333', borderRadius: 8, color: '#aaa', padding: '8px 12px', cursor: 'pointer', fontSize: 15 },
  iconBtn:      { width: 32, height: 32, borderRadius: 8, border: '1px solid #3a3a5a', background: '#141420', color: '#bbb', cursor: 'pointer', fontSize: 18, padding: 0 },
};
