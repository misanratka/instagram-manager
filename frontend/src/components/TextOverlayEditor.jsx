import React, { useState, useEffect, useRef, useCallback } from 'react';

const FONTS = ['SF Pro Display', 'Helvetica Neue', 'Arial', 'Georgia', 'Impact', 'Courier New'];
const COLORS = ['#FFFFFF','#000000','#FF3B30','#FF9500','#FFCC00','#34C759','#007AFF','#5856D6','#FF2D55'];

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// FULL SCREEN Instagram Stories style editor
export default function TextOverlayEditor({ videoSrc, textBoxes, onChange, onClose }) {

  const makeBox = (raw) => {
    const rawText = raw?.text || 'Tap to edit';
    return {
      id: raw?.id ?? 1,
      lines: rawText.split('\n'),
      fontSize: raw?.fontSize ?? 48,
      posX: raw?.posX ?? (raw?.xPct != null ? Math.round((raw.xPct/100)*window.innerWidth) : window.innerWidth/2),
      posY: raw?.posY ?? (raw?.yPct != null ? Math.round((raw.yPct/100)*window.innerHeight) : window.innerHeight/2),
      font: raw?.font ?? 'SF Pro Display',
      textColor: raw?.textColor ?? raw?.colorHex ?? '#FFFFFF',
      bg: raw?.bg ?? 'none',
    };
  };

  const [boxes, setBoxes] = useState(() => textBoxes?.length ? textBoxes.map(makeBox) : [makeBox(null)]);
  const [activeId, setActiveId] = useState(() => textBoxes?.[0]?.id ?? 1);
  const [showPanel, setShowPanel] = useState(false);

  const canvasRef = useRef(null);
  const videoRef = useRef(null);
  const gestureRef = useRef(null);
  const ptrsRef = useRef(new Map());
  const stateRef = useRef({ boxes, activeId });
  
  const [screenSize, setScreenSize] = useState({ w: window.innerWidth, h: window.innerHeight });

  useEffect(() => { stateRef.current = { boxes, activeId }; }, [boxes, activeId]);

  // Full screen dimensions
  useEffect(() => {
    function resize() {
      setScreenSize({ w: window.innerWidth, h: window.innerHeight });
    }
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  const CANVAS_W = screenSize.w;
  const CANVAS_H = screenSize.h;

  // Emit changes to parent
  useEffect(() => {
    const out = boxes.map(b => ({
      id: b.id, text: b.lines.join('\n'), fontSize: b.fontSize, posX: b.posX, posY: b.posY,
      font: b.font, textColor: b.textColor, colorHex: b.textColor,
      xPct: (b.posX / CANVAS_W) * 100, yPct: (b.posY / CANVAS_H) * 100,
      bg: b.bg, align: 'center', widthPct: 80,
    }));
    onChange(out.filter(b => b.text.trim()));
  }, [boxes, CANVAS_W, CANVAS_H]); // eslint-disable-line

  const updateBox = useCallback((id, patch) => {
    setBoxes(prev => prev.map(b => b.id === id ? { ...b, ...patch } : b));
  }, []);

  const activeBox = boxes.find(b => b.id === activeId) ?? boxes[0];

  const addBox = () => {
    const id = Date.now();
    setBoxes(prev => [...prev, makeBox({ id, text: 'New Text', posX: CANVAS_W/2, posY: CANVAS_H/3 })]);
    setActiveId(id);
    setShowPanel(true);
  };

  const removeBox = (id) => {
    setBoxes(prev => { const n = prev.filter(b => b.id !== id); return n.length ? n : [makeBox(null)]; });
    setActiveId(prev => prev === id ? (boxes.find(b => b.id !== id)?.id ?? 1) : prev);
  };

  const splitLine = (id, lineIdx, charIdx) => {
    setBoxes(prev => prev.map(b => {
      if (b.id !== id) return b;
      const lines = [...b.lines];
      const line = lines[lineIdx] ?? '';
      let at = charIdx ?? Math.floor(line.length / 2);
      if (charIdx == null) {
        const mid = Math.floor(line.length / 2);
        at = line.lastIndexOf(' ', mid);
        if (at <= 0) at = line.indexOf(' ', mid);
        if (at <= 0) at = mid;
      }
      lines.splice(lineIdx, 1, line.slice(0, at).trimEnd() || ' ', line.slice(at).trimStart() || ' ');
      return { ...b, lines };
    }));
  };

  const mergeLine = (id, lineIdx) => {
    if (lineIdx === 0) return;
    setBoxes(prev => prev.map(b => {
      if (b.id !== id) return b;
      const lines = [...b.lines];
      lines[lineIdx - 1] = (lines[lineIdx - 1] + ' ' + lines[lineIdx]).trim();
      lines.splice(lineIdx, 1);
      return { ...b, lines };
    }));
  };

  const updateLine = (id, lineIdx, value) => {
    setBoxes(prev => prev.map(b => {
      if (b.id !== id) return b;
      const lines = [...b.lines];
      lines[lineIdx] = value;
      return { ...b, lines };
    }));
  };

  // ── FULL SCREEN CANVAS DRAW ────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { boxes, activeId } = stateRef.current;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Draw video FULL SCREEN (cover entire canvas)
    const vid = videoRef.current;
    if (vid && vid.readyState >= 2) {
      try {
        const vw = vid.videoWidth, vh = vid.videoHeight;
        const vRatio = vw / vh;
        const cRatio = CANVAS_W / CANVAS_H;
        let drawW, drawH, offsetX = 0, offsetY = 0;
        
        // Cover mode — fill entire screen
        if (vRatio > cRatio) {
          drawH = CANVAS_H;
          drawW = drawH * vRatio;
          offsetX = (CANVAS_W - drawW) / 2;
        } else {
          drawW = CANVAS_W;
          drawH = drawW / vRatio;
          offsetY = (CANVAS_H - drawH) / 2;
        }
        ctx.drawImage(vid, offsetX, offsetY, drawW, drawH);
      } catch (_) {}
    }

    // Draw text overlays
    boxes.forEach(b => {
      const isActive = b.id === activeId;
      const lineH = b.fontSize * 1.3;
      const totalH = b.lines.length * lineH;
      const startY = b.posY - totalH / 2 + lineH / 2;
      
      ctx.font = `700 ${b.fontSize}px ${b.font}, -apple-system, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      b.lines.forEach((line, i) => {
        const ly = startY + i * lineH;
        const tw = ctx.measureText(line).width;
        const pad = 12;

        // Background
        if (b.bg !== 'none') {
          ctx.fillStyle = 
            b.bg === 'black' ? 'rgba(0,0,0,0.8)' :
            b.bg === 'dark' ? 'rgba(0,0,0,0.6)' :
            b.bg === 'white' ? 'rgba(255,255,255,0.9)' :
            'rgba(255,255,255,0.7)';
          ctx.beginPath();
          ctx.roundRect(b.posX - tw/2 - pad, ly - b.fontSize/2 - 6, tw + pad*2, b.fontSize + 12, 8);
          ctx.fill();
        }

        // Text - FLAT, NO SHADOW
        ctx.fillStyle = b.textColor;
        ctx.fillText(line, b.posX, ly);
      });

      // Active outline
      if (isActive) {
        const maxTw = Math.max(...b.lines.map(l => ctx.measureText(l).width));
        const pad = 28;
        ctx.strokeStyle = '#007AFF';
        ctx.lineWidth = 3;
        ctx.setLineDash([]);
        ctx.strokeRect(
          b.posX - maxTw/2 - pad,
          b.posY - totalH/2 - pad/2,
          maxTw + pad*2,
          totalH + pad
        );
      }
    });
  }, [CANVAS_W, CANVAS_H]);

  useEffect(() => {
    let raf;
    const loop = () => { draw(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [draw]);

  // ── GESTURES ────────────────────────────────────────────────────────────────
  function hitTest(box, cx, cy) {
    if (!box || !canvasRef.current) return false;
    const ctx = canvasRef.current.getContext('2d');
    ctx.font = `700 ${box.fontSize}px ${box.font}`;
    const maxTw = Math.max(...box.lines.map(l => ctx.measureText(l).width));
    const totalH = box.lines.length * box.fontSize * 1.3;
    const pad = 40;
    return cx >= box.posX - maxTw/2 - pad && cx <= box.posX + maxTw/2 + pad &&
           cy >= box.posY - totalH/2 - pad && cy <= box.posY + totalH/2 + pad;
  }

  function toCanvas(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    return { cx: (e.clientX - rect.left)*(CANVAS_W/rect.width), cy: (e.clientY - rect.top)*(CANVAS_H/rect.height) };
  }

  function onPointerDown(e) {
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
    ptrsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const { cx, cy } = toCanvas(e);

    if (ptrsRef.current.size >= 2) {
      const pts = [...ptrsRef.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const box = stateRef.current.boxes.find(b => b.id === stateRef.current.activeId);
      gestureRef.current = { mode: 'pinch', startDist: dist, startFontSize: box?.fontSize ?? 48 };
      return;
    }
    
    const { boxes } = stateRef.current;
    for (let i = boxes.length - 1; i >= 0; i--) {
      if (hitTest(boxes[i], cx, cy)) {
        setActiveId(boxes[i].id);
        gestureRef.current = { mode: 'drag', startCX: e.clientX, startCY: e.clientY, startPX: boxes[i].posX, startPY: boxes[i].posY, id: boxes[i].id };
        return;
      }
    }
    gestureRef.current = null;
  }

  function onPointerMove(e) {
    const ptr = ptrsRef.current.get(e.pointerId);
    if (ptr) { ptr.x = e.clientX; ptr.y = e.clientY; }
    const g = gestureRef.current;
    if (!g) return;
    
    if (g.mode === 'drag') {
      const rect = canvasRef.current.getBoundingClientRect();
      updateBox(g.id, {
        posX: clamp(Math.round(g.startPX + (e.clientX - g.startCX)*(CANVAS_W/rect.width)), 50, CANVAS_W-50),
        posY: clamp(Math.round(g.startPY + (e.clientY - g.startCY)*(CANVAS_H/rect.height)), 50, CANVAS_H-50)
      });
    } else if (g.mode === 'pinch') {
      const pts = [...ptrsRef.current.values()];
      if (pts.length < 2) return;
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      updateBox(activeBox?.id, { fontSize: clamp(Math.round(g.startFontSize * dist / g.startDist), 24, 140) });
    }
  }

  function onPointerUp(e) {
    ptrsRef.current.delete(e.pointerId);
    if (ptrsRef.current.size === 0) gestureRef.current = null;
  }

  const ab = activeBox;

  return (
    <div style={S.root}>
      {/* Top bar */}
      <div style={S.topBar}>
        <button onClick={onClose} style={S.btnTop}>Done</button>
        <button onClick={addBox} style={S.btnTop}>+ Text</button>
      </div>

      {/* Full screen canvas */}
      <canvas
        ref={canvasRef} width={CANVAS_W} height={CANVAS_H}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove}
        onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        style={S.canvas}
      />
      {videoSrc && <video ref={videoRef} src={videoSrc} style={{ display:'none' }} loop playsInline muted autoPlay />}

      {/* Bottom control toggle */}
      <button 
        onClick={() => setShowPanel(!showPanel)} 
        style={{ ...S.toggle, bottom: showPanel ? 'calc(55vh + 10px)' : '20px' }}
      >
        {showPanel ? 'Hide' : 'Edit Text'}
      </button>

      {/* Slide-up panel */}
      <div style={{ ...S.panel, transform: showPanel ? 'translateY(0)' : 'translateY(100%)' }}>
        
        {/* Tabs for multiple texts */}
        {boxes.length > 1 && (
          <div style={S.tabs}>
            {boxes.map((b, i) => (
              <button key={b.id} onClick={() => setActiveId(b.id)} style={b.id === activeId ? S.tabOn : S.tab}>
                {i + 1}
              </button>
            ))}
          </div>
        )}

        {/* Lines */}
        <Sec title="TEXT">
          {ab?.lines.map((line, li) => (
            <div key={li} style={S.row}>
              <input
                type="text" value={line}
                onChange={e => updateLine(ab.id, li, e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); splitLine(ab.id, li, e.currentTarget.selectionStart); }
                  if (e.key === 'Backspace' && e.currentTarget.selectionStart === 0 && li > 0) { e.preventDefault(); mergeLine(ab.id, li); }
                }}
                style={S.input}
                placeholder={`Line ${li+1}`}
              />
              <button onClick={() => splitLine(ab.id, li)} style={S.btnSm}>Split</button>
              {li > 0 && <button onClick={() => mergeLine(ab.id, li)} style={S.btnSm2}>Join</button>}
              {ab.lines.length > 1 && <button onClick={() => updateBox(ab.id, { lines: ab.lines.filter((_,i)=>i!==li) })} style={S.btnX}>×</button>}
            </div>
          ))}
        </Sec>

        <Div />

        {/* Size */}
        <Sec title={`SIZE — ${ab?.fontSize ?? 48}PX`}>
          <input type="range" min={24} max={140} value={ab?.fontSize ?? 48}
            onChange={e => updateBox(ab.id, { fontSize: +e.target.value })} style={S.slider} />
        </Sec>

        <Div />

        {/* Font */}
        <Sec title="FONT">
          <select value={ab?.font ?? 'SF Pro Display'} onChange={e => updateBox(ab.id, { font: e.target.value })} style={S.select}>
            {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </Sec>

        {/* Color */}
        <Sec title="COLOR">
          <div style={S.colors}>
            {COLORS.map(c => (
              <button key={c} onClick={() => updateBox(ab.id, { textColor: c })}
                style={{ ...S.color, background: c, border: ab?.textColor === c ? '3px solid #007AFF' : '2px solid #E5E5E5' }} />
            ))}
            <input type="color" value={ab?.textColor ?? '#FFFFFF'} onChange={e => updateBox(ab.id, { textColor: e.target.value })} style={S.picker} />
          </div>
        </Sec>

        {/* Background */}
        <Sec title="BACKGROUND">
          <div style={S.bgs}>
            {[{ v: 'none', l: 'None' }, { v: 'dark', l: 'Dark' }, { v: 'black', l: 'Black' }, { v: 'white', l: 'White' }].map(o => (
              <button key={o.v} onClick={() => updateBox(ab.id, { bg: o.v })} style={ab?.bg === o.v ? S.bgOn : S.bgOff}>
                {o.l}
              </button>
            ))}
          </div>
        </Sec>

        <Div />

        {/* Actions */}
        <div style={S.acts}>
          <button onClick={() => removeBox(ab.id)} style={S.del}>Delete</button>
          <button onClick={onClose} style={S.done}>Done</button>
        </div>
      </div>
    </div>
  );
}

function Sec({ title, children }) {
  return <div style={{ marginBottom: 18 }}><div style={{ fontSize: 11, fontWeight: 600, color: '#8E8E93', letterSpacing: '0.06em', marginBottom: 10 }}>{title}</div>{children}</div>;
}
function Div() { return <div style={{ height: 1, background: 'rgba(255,255,255,0.1)', margin: '18px 0' }} />; }

const S = {
  root: { position: 'fixed', inset: 0, zIndex: 9999, background: '#000', overflow: 'hidden', fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif' },
  
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10001, padding: '12px 20px', display: 'flex', justifyContent: 'space-between', background: 'linear-gradient(180deg, rgba(0,0,0,0.6) 0%, transparent 100%)' },
  btnTop: { background: 'transparent', border: 'none', color: '#FFF', fontSize: 17, fontWeight: 600, cursor: 'pointer', padding: 0 },
  
  canvas: { width: '100%', height: '100%', display: 'block', touchAction: 'none', position: 'absolute', inset: 0 },
  
  toggle: { position: 'fixed', left: '50%', transform: 'translateX(-50%)', zIndex: 10002, background: '#007AFF', border: 'none', borderRadius: 20, color: '#FFF', padding: '12px 36px', fontSize: 15, fontWeight: 600, cursor: 'pointer', transition: 'bottom 0.3s ease', boxShadow: '0 4px 20px rgba(0,122,255,0.4)' },
  
  panel: { position: 'fixed', bottom: 0, left: 0, right: 0, height: '55vh', background: 'rgba(0,0,0,0.95)', backdropFilter: 'blur(20px)', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: '24px 20px 40px', overflowY: 'auto', transition: 'transform 0.3s ease', zIndex: 10000 },
  
  tabs: { display: 'flex', gap: 8, marginBottom: 20 },
  tab: { padding: '10px 20px', borderRadius: 10, fontSize: 15, fontWeight: 500, cursor: 'pointer', background: 'rgba(255,255,255,0.1)', border: 'none', color: '#FFF' },
  tabOn: { padding: '10px 20px', borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: 'pointer', background: '#007AFF', border: 'none', color: '#FFF' },
  
  row: { display: 'flex', gap: 6, marginBottom: 10, alignItems: 'center' },
  input: { flex: 1, padding: '12px 14px', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 10, fontSize: 16, fontFamily: 'inherit', background: 'rgba(255,255,255,0.08)', color: '#FFF', outline: 'none' },
  btnSm: { padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none', background: 'rgba(0,122,255,0.2)', color: '#007AFF', whiteSpace: 'nowrap' },
  btnSm2: { padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer', border: 'none', background: 'rgba(255,159,10,0.2)', color: '#FF9F0A', whiteSpace: 'nowrap' },
  btnX: { padding: '10px 12px', borderRadius: 8, fontSize: 18, fontWeight: 400, cursor: 'pointer', border: 'none', background: 'rgba(255,59,48,0.2)', color: '#FF3B30' },
  
  slider: { width: '100%', height: 6, accentColor: '#007AFF', cursor: 'pointer' },
  select: { width: '100%', padding: '14px', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 10, fontSize: 16, background: 'rgba(255,255,255,0.08)', color: '#FFF', cursor: 'pointer', outline: 'none' },
  
  colors: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  color: { width: 40, height: 40, borderRadius: '50%', cursor: 'pointer', padding: 0, flexShrink: 0 },
  picker: { width: 48, height: 40, border: '1px solid rgba(255,255,255,0.2)', borderRadius: 10, cursor: 'pointer', padding: 2, background: 'rgba(255,255,255,0.08)' },
  
  bgs: { display: 'flex', gap: 8 },
  bgOff: { flex: 1, padding: '12px', borderRadius: 10, fontSize: 15, fontWeight: 500, cursor: 'pointer', background: 'rgba(255,255,255,0.1)', border: 'none', color: '#FFF' },
  bgOn: { flex: 1, padding: '12px', borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: 'pointer', background: '#007AFF', border: 'none', color: '#FFF' },
  
  acts: { display: 'flex', gap: 10, marginTop: 10 },
  del: { flex: 1, padding: '16px', borderRadius: 12, fontSize: 16, fontWeight: 500, cursor: 'pointer', background: 'rgba(255,59,48,0.15)', border: 'none', color: '#FF3B30' },
  done: { flex: 2, padding: '16px', borderRadius: 12, fontSize: 16, fontWeight: 600, cursor: 'pointer', background: '#007AFF', border: 'none', color: '#FFF' },
};
