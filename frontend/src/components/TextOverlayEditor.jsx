import React, { useState, useEffect, useRef, useCallback } from 'react';

const FONTS = ['SF Pro Display', 'Helvetica Neue', 'Arial', 'Georgia', 'Impact', 'Courier New'];
const COLORS = ['#FFFFFF','#000000','#FF3B30','#FF9500','#FFCC00','#34C759','#007AFF','#5856D6','#FF2D55'];

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function isMobile() { return window.innerWidth < 768; }

export default function TextOverlayEditor({ videoSrc, textBoxes, onChange, onClose }) {

  const makeBox = (raw) => {
    const rawText = raw?.text || 'Add Your Text';
    return {
      id:        raw?.id ?? 1,
      lines:     rawText.split('\n'),
      fontSize:  raw?.fontSize ?? 42,
      posX:      raw?.posX ?? (raw?.xPct != null ? Math.round((raw.xPct/100)*600) : 300),
      posY:      raw?.posY ?? (raw?.yPct != null ? Math.round((raw.yPct/100)*400) : 200),
      font:      raw?.font ?? 'SF Pro Display',
      textColor: raw?.textColor ?? raw?.colorHex ?? '#FFFFFF',
      bg:        raw?.bg ?? 'none',
    };
  };

  const [boxes, setBoxes] = useState(() => textBoxes?.length ? textBoxes.map(makeBox) : [makeBox(null)]);
  const [activeId, setActiveId] = useState(() => textBoxes?.[0]?.id ?? 1);
  const [showControls, setShowControls] = useState(false);

  const canvasRef = useRef(null);
  const videoRef = useRef(null);
  const gestureRef = useRef(null);
  const ptrsRef = useRef(new Map());
  const stateRef = useRef({ boxes, activeId });
  const [canvasSize, setCanvasSize] = useState({ w: 600, h: 400 });

  useEffect(() => { stateRef.current = { boxes, activeId }; }, [boxes, activeId]);

  useEffect(() => {
    function resize() {
      const mobile = isMobile();
      if (mobile) {
        const w = Math.min(window.innerWidth - 32, 600);
        const h = Math.round(w * (9/16));
        setCanvasSize({ w, h });
      } else {
        setCanvasSize({ w: 600, h: 400 });
      }
    }
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  const CANVAS_W = canvasSize.w;
  const CANVAS_H = canvasSize.h;

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
    setBoxes(prev => [...prev, makeBox({ id, text: 'New Text', posX: CANVAS_W/2, posY: CANVAS_H/2 })]);
    setActiveId(id);
    setShowControls(true);
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
      let at = charIdx;
      if (at == null) {
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

  // ── CANVAS DRAW (NO SHADOWS, CLEAN FLAT DESIGN) ────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { boxes, activeId } = stateRef.current;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    const vid = videoRef.current;
    if (vid && vid.readyState >= 2) {
      try {
        const vw = vid.videoWidth, vh = vid.videoHeight;
        const vRatio = vw / vh, cRatio = CANVAS_W / CANVAS_H;
        let drawW, drawH, offsetX = 0, offsetY = 0;
        if (vRatio > cRatio) {
          drawH = CANVAS_H; drawW = drawH * vRatio; offsetX = (CANVAS_W - drawW) / 2;
        } else {
          drawW = CANVAS_W; drawH = drawW / vRatio; offsetY = (CANVAS_H - drawH) / 2;
        }
        ctx.drawImage(vid, offsetX, offsetY, drawW, drawH);
      } catch (_) {}
    }

    boxes.forEach(b => {
      const isActive = b.id === activeId;
      const lineH = b.fontSize * 1.25;
      const totalH = b.lines.length * lineH;
      const startY = b.posY - totalH / 2 + lineH / 2;
      
      // PREMIUM FONT RENDERING - NO SHADOWS, CLEAN & FLAT
      ctx.font = `700 ${b.fontSize}px ${b.font}, -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      b.lines.forEach((line, i) => {
        const ly = startY + i * lineH;
        const tw = ctx.measureText(line).width;
        const pad = 10;

        // Background (clean, no gradients)
        if (b.bg !== 'none') {
          ctx.fillStyle = 
            b.bg === 'black' ? 'rgba(0,0,0,0.85)' :
            b.bg === 'dark' ? 'rgba(0,0,0,0.65)' :
            b.bg === 'white' ? 'rgba(255,255,255,0.95)' :
            'rgba(255,255,255,0.75)';
          ctx.beginPath();
          ctx.roundRect(b.posX - tw/2 - pad, ly - b.fontSize/2 - 6, tw + pad*2, b.fontSize + 12, 6);
          ctx.fill();
        }

        // Text - FLAT, NO SHADOW
        ctx.fillStyle = b.textColor;
        ctx.fillText(line, b.posX, ly);
      });

      // Active indicator - minimal clean outline
      if (isActive) {
        const maxTw = Math.max(...b.lines.map(l => ctx.measureText(l).width));
        const pad = isMobile() ? 24 : 16;
        ctx.strokeStyle = '#007AFF';
        ctx.lineWidth = 2;
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

  // ── POINTER EVENTS ──────────────────────────────────────────────────────────
  function hitTest(box, cx, cy) {
    if (!box || !canvasRef.current) return false;
    const ctx = canvasRef.current.getContext('2d');
    ctx.font = `700 ${box.fontSize}px ${box.font}`;
    const maxTw = Math.max(...box.lines.map(l => ctx.measureText(l).width));
    const totalH = box.lines.length * box.fontSize * 1.25;
    const pad = isMobile() ? 30 : 24;
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
      gestureRef.current = { mode: 'pinch', startDist: dist, startFontSize: box?.fontSize ?? 42 };
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
        posX: clamp(Math.round(g.startPX + (e.clientX - g.startCX)*(CANVAS_W/rect.width)), 30, CANVAS_W-30),
        posY: clamp(Math.round(g.startPY + (e.clientY - g.startCY)*(CANVAS_H/rect.height)), 30, CANVAS_H-30)
      });
    } else if (g.mode === 'pinch') {
      const pts = [...ptrsRef.current.values()];
      if (pts.length < 2) return;
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      updateBox(activeBox?.id, { fontSize: clamp(Math.round(g.startFontSize * dist / g.startDist), 20, 120) });
    }
  }

  function onPointerUp(e) {
    ptrsRef.current.delete(e.pointerId);
    if (ptrsRef.current.size === 0) gestureRef.current = null;
  }

  const ab = activeBox;
  const mobile = isMobile();

  return (
    <div style={S.root}>
      {/* Header */}
      <div style={S.header}>
        <button onClick={onClose} style={S.close}>Done</button>
        <h1 style={S.title}>Text Editor</h1>
        <button onClick={addBox} style={S.add}>+ Text</button>
      </div>

      {/* Canvas */}
      <div style={mobile ? S.canvasMobile : S.canvas}>
        <canvas
          ref={canvasRef} width={CANVAS_W} height={CANVAS_H}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove}
          onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
          style={S.cvs}
        />
        {videoSrc && <video ref={videoRef} src={videoSrc} style={{ display:'none' }} loop playsInline muted autoPlay />}
      </div>

      {/* Controls toggle (mobile) */}
      {mobile && (
        <button onClick={() => setShowControls(!showControls)} style={{...S.toggle, bottom: showControls ? 'calc(50% + 10px)' : '16px'}}>
          {showControls ? 'Hide' : 'Edit'}
        </button>
      )}

      {/* Control panel */}
      <div style={mobile ? {...S.panelMobile, transform: showControls ? 'translateY(0)' : 'translateY(100%)'} : S.panel}>
        
        {/* Tabs */}
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
        <Section title="TEXT LINES">
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
              {li > 0 && <button onClick={() => mergeLine(ab.id, li)} style={S.btnSm}>Join</button>}
              {ab.lines.length > 1 && <button onClick={() => updateBox(ab.id, { lines: ab.lines.filter((_,i)=>i!==li) })} style={S.btnDel}>×</button>}
            </div>
          ))}
        </Section>

        <Divider />

        {/* Size */}
        <Section title={`SIZE — ${ab?.fontSize ?? 42}PX`}>
          <input type="range" min={20} max={mobile ? 100 : 140} value={ab?.fontSize ?? 42}
            onChange={e => updateBox(ab.id, { fontSize: +e.target.value })} style={S.slider} />
        </Section>

        <Divider />

        {/* Font */}
        <Section title="FONT">
          <select value={ab?.font ?? 'SF Pro Display'} onChange={e => updateBox(ab.id, { font: e.target.value })} style={S.select}>
            {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
          </select>
        </Section>

        {/* Color */}
        <Section title="COLOR">
          <div style={S.colors}>
            {COLORS.map(c => (
              <button key={c} onClick={() => updateBox(ab.id, { textColor: c })}
                style={{ ...S.color, background: c, border: ab?.textColor === c ? '3px solid #007AFF' : '2px solid #E5E5E5' }} />
            ))}
            <input type="color" value={ab?.textColor ?? '#FFFFFF'} onChange={e => updateBox(ab.id, { textColor: e.target.value })} style={S.picker} />
          </div>
        </Section>

        {/* Background */}
        <Section title="BACKGROUND">
          <div style={S.bgs}>
            {[
              { v: 'none', l: 'None' },
              { v: 'dark', l: 'Dark' },
              { v: 'black', l: 'Black' },
              { v: 'white', l: 'White' },
            ].map(o => (
              <button key={o.v} onClick={() => updateBox(ab.id, { bg: o.v })}
                style={ab?.bg === o.v ? S.bgOn : S.bgOff}>
                {o.l}
              </button>
            ))}
          </div>
        </Section>

        <Divider />

        {/* Actions */}
        <div style={S.actions}>
          <button onClick={() => removeBox(ab.id)} style={S.delete}>Delete Text</button>
          <button onClick={onClose} style={S.done}>Done</button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: '#8E8E93', letterSpacing: '0.06em', marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, background: '#E5E5E5', margin: '20px 0' }} />;
}

const S = {
  root: { position: 'fixed', inset: 0, zIndex: 9999, background: '#F2F2F7', display: 'flex', flexDirection: 'column', fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif' },
  
  header: { padding: '12px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#FFF', borderBottom: '1px solid #E5E5E5' },
  title: { fontSize: 17, fontWeight: 600, color: '#000', margin: 0, flex: 1, textAlign: 'center' },
  close: { background: 'transparent', border: 'none', color: '#007AFF', fontSize: 17, fontWeight: 400, cursor: 'pointer', padding: 0 },
  add: { background: 'transparent', border: 'none', color: '#007AFF', fontSize: 17, fontWeight: 600, cursor: 'pointer', padding: 0 },
  
  canvas: { padding: '20px', display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 },
  canvasMobile: { padding: '16px', display: 'flex', justifyContent: 'center', alignItems: 'center', flex: 1 },
  cvs: { width: '100%', display: 'block', borderRadius: 12, boxShadow: '0 2px 20px rgba(0,0,0,0.08)', touchAction: 'none' },
  
  toggle: { position: 'fixed', left: '50%', transform: 'translateX(-50%)', zIndex: 10000, background: '#007AFF', border: 'none', borderRadius: 20, color: '#FFF', padding: '10px 32px', fontSize: 15, fontWeight: 600, cursor: 'pointer', transition: 'bottom 0.25s ease', boxShadow: '0 4px 16px rgba(0,122,255,0.3)' },
  
  panel: { background: '#FFF', padding: '24px', borderTop: '1px solid #E5E5E5', overflowY: 'auto' },
  panelMobile: { position: 'fixed', bottom: 0, left: 0, right: 0, maxHeight: '50vh', background: '#FFF', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: '20px', overflowY: 'auto', transition: 'transform 0.25s ease', boxShadow: '0 -4px 20px rgba(0,0,0,0.1)' },
  
  tabs: { display: 'flex', gap: 8, marginBottom: 20 },
  tab: { padding: '8px 20px', borderRadius: 8, fontSize: 15, fontWeight: 500, cursor: 'pointer', background: '#F2F2F7', border: 'none', color: '#8E8E93' },
  tabOn: { padding: '8px 20px', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer', background: '#007AFF', border: 'none', color: '#FFF' },
  
  row: { display: 'flex', gap: 6, marginBottom: 8, alignItems: 'center' },
  input: { flex: 1, padding: '10px 12px', border: '1px solid #E5E5E5', borderRadius: 8, fontSize: 16, fontFamily: 'inherit', background: '#FFF', outline: 'none' },
  btnSm: { padding: '8px 12px', borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: 'pointer', border: 'none', background: '#F2F2F7', color: '#007AFF' },
  btnDel: { padding: '8px 10px', borderRadius: 6, fontSize: 18, fontWeight: 400, cursor: 'pointer', border: 'none', background: '#FFEBEE', color: '#FF3B30' },
  
  slider: { width: '100%', height: 4, accentColor: '#007AFF', cursor: 'pointer' },
  select: { width: '100%', padding: '12px', border: '1px solid #E5E5E5', borderRadius: 8, fontSize: 16, background: '#FFF', cursor: 'pointer', outline: 'none' },
  
  colors: { display: 'flex', gap: 10, flexWrap: 'wrap' },
  color: { width: 36, height: 36, borderRadius: '50%', cursor: 'pointer', padding: 0, flexShrink: 0 },
  picker: { width: 44, height: 36, border: '1px solid #E5E5E5', borderRadius: 8, cursor: 'pointer', padding: 2 },
  
  bgs: { display: 'flex', gap: 8 },
  bgOff: { flex: 1, padding: '10px', borderRadius: 8, fontSize: 15, fontWeight: 500, cursor: 'pointer', background: '#F2F2F7', border: 'none', color: '#000' },
  bgOn: { flex: 1, padding: '10px', borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: 'pointer', background: '#007AFF', border: 'none', color: '#FFF' },
  
  actions: { display: 'flex', gap: 10 },
  delete: { flex: 1, padding: '14px', borderRadius: 10, fontSize: 16, fontWeight: 500, cursor: 'pointer', background: '#FFEBEE', border: 'none', color: '#FF3B30' },
  done: { flex: 2, padding: '14px', borderRadius: 10, fontSize: 16, fontWeight: 600, cursor: 'pointer', background: '#007AFF', border: 'none', color: '#FFF' },
};
