import React, { useState, useEffect, useRef, useCallback } from 'react';

const FONTS   = ['Arial', 'Georgia', 'Courier New', 'Verdana', 'Impact'];
const CANVAS_W = 600;
const CANVAS_H = 400;
const GRID     = 50;
const COLORS   = ['#ffffff','#000000','#facc15','#f87171','#34d399','#60a5fa','#e879f9','#fb923c'];

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Props (identical to original — NewPost.jsx needs NO changes):
//   videoSrc   – video URL shown in canvas background
//   textBoxes  – array of overlay objects from parent state
//   onChange   – called with updated array on every change
//   onClose    – called when user taps "Done"
export default function TextOverlayEditor({ videoSrc, textBoxes, onChange, onClose }) {

  const makeBox = (raw) => {
    const rawText = raw?.text || 'Add Your Text Here';
    return {
      id:        raw?.id       ?? 1,
      lines:     rawText.split('\n'),
      fontSize:  raw?.fontSize ?? 36,
      posX:      raw?.posX     ?? (raw?.xPct != null ? Math.round((raw.xPct/100)*CANVAS_W) : 200),
      posY:      raw?.posY     ?? (raw?.yPct != null ? Math.round((raw.yPct/100)*CANVAS_H) : 200),
      font:      raw?.font      ?? 'Arial',
      textColor: raw?.textColor ?? raw?.colorHex ?? '#ffffff',
      bg:        raw?.bg        ?? 'none',
    };
  };

  const [boxes, setBoxes]       = useState(() => textBoxes?.length ? textBoxes.map(makeBox) : [makeBox(null)]);
  const [activeId, setActiveId] = useState(() => textBoxes?.[0]?.id ?? 1);

  const canvasRef  = useRef(null);
  const videoRef   = useRef(null);
  const gestureRef = useRef(null);
  const ptrsRef    = useRef(new Map());
  const stateRef   = useRef({ boxes, activeId });

  useEffect(() => { stateRef.current = { boxes, activeId }; }, [boxes, activeId]);

  // Emit to parent on every change
  useEffect(() => {
    const out = boxes.map(b => ({
      id:        b.id,
      text:      b.lines.join('\n'),
      fontSize:  b.fontSize,
      posX:      b.posX,
      posY:      b.posY,
      font:      b.font,
      textColor: b.textColor,
      colorHex:  b.textColor,
      xPct:      (b.posX / CANVAS_W) * 100,
      yPct:      (b.posY / CANVAS_H) * 100,
      bg:        b.bg,
      align:     'center',
      widthPct:  80,
    }));
    onChange(out.filter(b => b.text.trim()));
  }, [boxes]); // eslint-disable-line

  const updateBox = useCallback((id, patch) => {
    setBoxes(prev => prev.map(b => b.id === id ? { ...b, ...patch } : b));
  }, []);

  const activeBox = boxes.find(b => b.id === activeId) ?? boxes[0];

  const addBox = () => {
    const id = Date.now();
    setBoxes(prev => [...prev, makeBox({ id, text: 'New Text', posX: 150 + prev.length*30, posY: 180 + prev.length*30 })]);
    setActiveId(id);
  };

  const removeBox = (id) => {
    setBoxes(prev => { const n = prev.filter(b => b.id !== id); return n.length ? n : [makeBox(null)]; });
    setActiveId(prev => prev === id ? (boxes.find(b => b.id !== id)?.id ?? 1) : prev);
  };

  // ── LINE SPLIT ──────────────────────────────────────────────────────────────
  const splitLine = (id, lineIdx, charIdx) => {
    setBoxes(prev => prev.map(b => {
      if (b.id !== id) return b;
      const lines = [...b.lines];
      const line  = lines[lineIdx] ?? '';
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

  // ── CANVAS DRAW ─────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { boxes, activeId } = stateRef.current;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    const vid = videoRef.current;
    if (vid && vid.readyState >= 2) { try { ctx.drawImage(vid, 0, 0, CANVAS_W, CANVAS_H); } catch (_) {} }

    ctx.strokeStyle = 'rgba(255,255,255,0.07)'; ctx.lineWidth = 0.5;
    for (let x = GRID; x < CANVAS_W; x += GRID) { ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,CANVAS_H); ctx.stroke(); }
    for (let y = GRID; y < CANVAS_H; y += GRID) { ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(CANVAS_W,y); ctx.stroke(); }

    boxes.forEach(b => {
      const isActive = b.id === activeId;
      const lineH    = b.fontSize * 1.3;
      const totalH   = b.lines.length * lineH;
      const startY   = b.posY - totalH / 2 + lineH / 2;
      ctx.font = `bold ${b.fontSize}px ${b.font}`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';

      b.lines.forEach((line, i) => {
        const ly  = startY + i * lineH;
        const tw  = ctx.measureText(line).width;
        const pad = 8;
        if (b.bg !== 'none') {
          ctx.fillStyle = b.bg === 'black' ? '#000' : b.bg === 'dark' ? 'rgba(0,0,0,0.72)' : b.bg === 'white' ? '#fff' : 'rgba(255,255,255,0.82)';
          ctx.beginPath(); ctx.roundRect(b.posX - tw/2 - pad, ly - b.fontSize/2 - 4, tw + pad*2, b.fontSize + 8, 5); ctx.fill();
        }
        ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillText(line, b.posX+1.5, ly+1.5);
        ctx.fillStyle = b.textColor; ctx.fillText(line, b.posX, ly);
      });

      if (isActive) {
        const maxTw = Math.max(...b.lines.map(l => ctx.measureText(l).width));
        const pad   = 12;
        ctx.strokeStyle = '#facc15'; ctx.lineWidth = 1.5;
        ctx.setLineDash([4,3]);
        ctx.strokeRect(b.posX - maxTw/2 - pad, b.posY - totalH/2 - pad/2, maxTw + pad*2, totalH + pad);
        ctx.setLineDash([]);
      }
    });
  }, []);

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
    ctx.font = `bold ${box.fontSize}px ${box.font}`;
    const maxTw  = Math.max(...box.lines.map(l => ctx.measureText(l).width));
    const totalH = box.lines.length * box.fontSize * 1.3;
    const pad    = 24;
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
      const box  = stateRef.current.boxes.find(b => b.id === stateRef.current.activeId);
      gestureRef.current = { mode: 'pinch', startDist: dist, startFontSize: box?.fontSize ?? 36 };
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
      updateBox(g.id, { posX: clamp(Math.round(g.startPX + (e.clientX - g.startCX)*(CANVAS_W/rect.width)), 10, CANVAS_W-10), posY: clamp(Math.round(g.startPY + (e.clientY - g.startCY)*(CANVAS_H/rect.height)), 10, CANVAS_H-10) });
    } else if (g.mode === 'pinch') {
      const pts = [...ptrsRef.current.values()];
      if (pts.length < 2) return;
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      updateBox(activeBox?.id, { fontSize: clamp(Math.round(g.startFontSize * dist / g.startDist), 12, 120) });
    }
  }

  function onPointerUp(e) { ptrsRef.current.delete(e.pointerId); if (ptrsRef.current.size === 0) gestureRef.current = null; }

  // ── RENDER ──────────────────────────────────────────────────────────────────
  const ab = activeBox;

  return (
    <div style={S.overlay}>
      <div style={S.header}>
        <div>
          <h1 style={S.title}>Text Gesture Editor</h1>
          <p style={S.subtitle}>Pinch 2 fingers to resize • Drag to move • ↵ split to break a line</p>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <button onClick={addBox} style={S.addBtn}>+ Add Text</button>
          <button onClick={onClose} style={S.doneBtn}>Done</button>
        </div>
      </div>
      <div style={S.hr} />

      <div style={S.canvasWrap}>
        <canvas ref={canvasRef} width={CANVAS_W} height={CANVAS_H}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove}
          onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
          style={S.canvas} />
        {videoSrc && <video ref={videoRef} src={videoSrc} style={{ display:'none' }} loop playsInline muted autoPlay />}
        <p style={S.hint}>👆 2 fingers to resize • 1 finger to move</p>
      </div>

      <div style={S.cardWrap}>
        <div style={S.card}>

          {boxes.length > 1 && (
            <div style={S.tabs}>
              {boxes.map((b, i) => (
                <button key={b.id} onClick={() => setActiveId(b.id)}
                  style={{ ...S.tab, ...(b.id === activeId ? S.tabOn : {}) }}>
                  Text {i+1}
                </button>
              ))}
            </div>
          )}

          {/* ── LINE EDITOR with split ── */}
          <Label text={`LINES — press Enter inside a box to split, Backspace at start to join`} />
          {ab?.lines.map((line, li) => (
            <div key={li} style={S.lineRow}>
              <textarea
                value={line} rows={1}
                onChange={e => updateLine(ab.id, li, e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); splitLine(ab.id, li, e.target.selectionStart); }
                  if (e.key === 'Backspace' && e.target.selectionStart === 0 && li > 0) { e.preventDefault(); mergeLine(ab.id, li); }
                }}
                style={S.lineInput}
                placeholder={`Line ${li+1}`}
              />
              <button onClick={() => splitLine(ab.id, li)} style={S.splitBtn} title="Split this line in two">↵ split</button>
              {li > 0 && <button onClick={() => mergeLine(ab.id, li)} style={S.mergeBtn} title="Join with line above">↑ join</button>}
              {ab.lines.length > 1 && (
                <button onClick={() => { const lines = ab.lines.filter((_,i)=>i!==li); updateBox(ab.id,{lines}); }} style={S.delBtn}>✕</button>
              )}
            </div>
          ))}

          <div style={S.divLight} />

          <Label text={`FONT SIZE: ${ab?.fontSize ?? 36}PX`} />
          <input type="range" min={12} max={120} value={ab?.fontSize ?? 36}
            onChange={e => updateBox(ab.id, { fontSize: +e.target.value })} style={S.slider} />

          <Label text={`POSITION  X: ${ab?.posX ?? 0}  ·  Y: ${ab?.posY ?? 0}`} />
          <div style={{ display:'flex', gap:10 }}>
            <input type="range" min={0} max={CANVAS_W} value={ab?.posX ?? 0}
              onChange={e => updateBox(ab.id, { posX: +e.target.value })} style={{ ...S.slider, flex:1 }} />
            <input type="range" min={0} max={CANVAS_H} value={ab?.posY ?? 0}
              onChange={e => updateBox(ab.id, { posY: +e.target.value })} style={{ ...S.slider, flex:1 }} />
          </div>

          <div style={S.divLight} />

          <Label text="FONT FAMILY" />
          <select value={ab?.font ?? 'Arial'} onChange={e => updateBox(ab.id, { font: e.target.value })} style={S.select}>
            {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
          </select>

          <Label text="TEXT COLOR" />
          <div style={S.swatches}>
            {COLORS.map(c => (
              <button key={c} onClick={() => updateBox(ab.id, { textColor: c })}
                style={{ ...S.swatch, background:c, outline: ab?.textColor===c ? '3px solid #facc15' : '2px solid rgba(0,0,0,0.15)' }} />
            ))}
            <input type="color" value={ab?.textColor ?? '#ffffff'} onChange={e => updateBox(ab.id, { textColor: e.target.value })} style={S.cpick} />
          </div>

          <Label text="TEXT BACKGROUND" />
          <div style={S.bgRow}>
            {[{v:'none',l:'○ None'},{v:'dark',l:'■ Dark'},{v:'black',l:'■ Black'},{v:'light',l:'□ Light'},{v:'white',l:'□ White'}].map(o => (
              <button key={o.v} onClick={() => updateBox(ab.id, { bg: o.v })}
                style={{ ...S.bgBtn, background: ab?.bg===o.v?'#1a1a3a':'#111', border: ab?.bg===o.v?'1.5px solid #7b6fff':'1px solid #2a2a2a', color: ab?.bg===o.v?'#7b6fff':'#888' }}>
                {o.l}
              </button>
            ))}
          </div>

          <div style={S.divLight} />
          <button onClick={() => removeBox(ab.id)} style={S.removeBtn}>🗑 Remove This Text Block</button>
        </div>
      </div>
    </div>
  );
}

function Label({ text }) {
  return <div style={{ fontSize:10, fontWeight:700, color:'#9ca3af', letterSpacing:'0.07em', textTransform:'uppercase', margin:'12px 0 6px' }}>{text}</div>;
}

const S = {
  overlay:  { position:'fixed', inset:0, zIndex:9999, background:'#fff', display:'flex', flexDirection:'column', overflowY:'auto', fontFamily:'-apple-system,BlinkMacSystemFont,"SF Pro Display",sans-serif' },
  header:   { padding:'18px 24px 0', display:'flex', justifyContent:'space-between', alignItems:'flex-start', flexShrink:0 },
  title:    { fontSize:28, fontWeight:700, color:'#c0c0c0', margin:0, letterSpacing:'-0.02em' },
  subtitle: { fontSize:12, color:'#aaa', margin:'4px 0 0' },
  doneBtn:  { background:'linear-gradient(135deg,#833ab4,#fd1d1d)', border:'none', borderRadius:8, color:'#fff', padding:'9px 20px', fontWeight:700, cursor:'pointer', fontSize:14 },
  addBtn:   { background:'#1a1a1a', border:'1px solid #333', borderRadius:8, color:'#aaa', padding:'8px 14px', fontWeight:600, cursor:'pointer', fontSize:13 },
  hr:       { height:2, background:'#222', margin:'14px 0 0' },
  divLight: { height:1, background:'#f0f0f0', margin:'14px 0' },
  canvasWrap:{ padding:'16px 24px 6px', flexShrink:0 },
  canvas:   { width:'100%', maxWidth:700, display:'block', margin:'0 auto', touchAction:'none', borderRadius:10, border:'1px solid #1a1a1a', cursor:'crosshair' },
  hint:     { textAlign:'center', fontSize:13, color:'#f59e0b', margin:'10px 0 0', fontWeight:500 },
  cardWrap: { padding:'8px 24px 40px', flexShrink:0 },
  card:     { maxWidth:700, margin:'0 auto', background:'#fff', border:'1.5px solid #e5e7eb', borderRadius:14, padding:'20px 20px 18px' },
  tabs:     { display:'flex', gap:6, marginBottom:16, flexWrap:'wrap' },
  tab:      { padding:'5px 14px', borderRadius:6, fontSize:12, fontWeight:600, cursor:'pointer', background:'#f5f5f5', border:'1px solid #e0e0e0', color:'#888' },
  tabOn:    { background:'#1a1a3a', border:'1px solid #7b6fff', color:'#7b6fff' },
  lineRow:  { display:'flex', alignItems:'center', gap:5, marginBottom:7 },
  lineInput:{ flex:1, padding:'8px 10px', border:'1.5px solid #e5e7eb', borderRadius:8, fontSize:14, fontFamily:'inherit', color:'#111', outline:'none', resize:'none', lineHeight:1.4, boxSizing:'border-box' },
  splitBtn: { padding:'5px 8px', borderRadius:6, fontSize:11, fontWeight:700, cursor:'pointer', border:'1.5px solid #2563eb', background:'#eff6ff', color:'#2563eb', whiteSpace:'nowrap', flexShrink:0 },
  mergeBtn: { padding:'5px 8px', borderRadius:6, fontSize:11, fontWeight:700, cursor:'pointer', border:'1.5px solid #d97706', background:'#fffbeb', color:'#d97706', whiteSpace:'nowrap', flexShrink:0 },
  delBtn:   { padding:'5px 7px', borderRadius:6, fontSize:11, fontWeight:700, cursor:'pointer', border:'1.5px solid #dc2626', background:'#fef2f2', color:'#dc2626', flexShrink:0 },
  slider:   { width:'100%', accentColor:'#2563eb', cursor:'pointer', display:'block', marginBottom:4 },
  select:   { width:'100%', padding:'9px 12px', border:'1.5px solid #e5e7eb', borderRadius:8, fontSize:14, background:'#fff', cursor:'pointer', outline:'none', color:'#111', marginBottom:4 },
  swatches: { display:'flex', gap:7, flexWrap:'wrap', alignItems:'center', marginBottom:4 },
  swatch:   { width:26, height:26, borderRadius:'50%', cursor:'pointer', border:'none', padding:0, flexShrink:0 },
  cpick:    { width:34, height:28, border:'1.5px solid #e5e7eb', borderRadius:6, cursor:'pointer', padding:2 },
  bgRow:    { display:'flex', gap:6, flexWrap:'wrap', marginBottom:4 },
  bgBtn:    { padding:'6px 12px', borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer' },
  removeBtn:{ width:'100%', padding:10, background:'#fef2f2', border:'1.5px solid #fca5a5', borderRadius:8, color:'#dc2626', fontSize:13, fontWeight:600, cursor:'pointer', marginTop:4 },
};
