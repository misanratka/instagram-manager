import React, { useState, useEffect, useRef, useCallback } from 'react';

const FONTS   = ['Arial', 'Georgia', 'Courier New', 'Verdana', 'Impact'];
const COLORS  = ['#ffffff','#000000','#facc15','#f87171','#34d399','#60a5fa','#e879f9','#fb923c'];

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function isMobile() { return window.innerWidth < 768; }

// Props (unchanged):
//   videoSrc, textBoxes, onChange, onClose
export default function TextOverlayEditor({ videoSrc, textBoxes, onChange, onClose }) {

  const makeBox = (raw) => {
    const rawText = raw?.text || 'Add Your Text Here';
    return {
      id:        raw?.id ?? 1,
      lines:     rawText.split('\n'),
      fontSize:  raw?.fontSize ?? 36,
      posX:      raw?.posX ?? (raw?.xPct != null ? Math.round((raw.xPct/100)*600) : 300),
      posY:      raw?.posY ?? (raw?.yPct != null ? Math.round((raw.yPct/100)*400) : 200),
      font:      raw?.font ?? 'Arial',
      textColor: raw?.textColor ?? raw?.colorHex ?? '#ffffff',
      bg:        raw?.bg ?? 'none',
    };
  };

  const [boxes, setBoxes]       = useState(() => textBoxes?.length ? textBoxes.map(makeBox) : [makeBox(null)]);
  const [activeId, setActiveId] = useState(() => textBoxes?.[0]?.id ?? 1);
  const [showControls, setShowControls] = useState(false); // Mobile: hide controls by default

  const canvasRef  = useRef(null);
  const videoRef   = useRef(null);
  const gestureRef = useRef(null);
  const ptrsRef    = useRef(new Map());
  const stateRef   = useRef({ boxes, activeId });
  const [canvasSize, setCanvasSize] = useState({ w: 600, h: 400 });

  useEffect(() => { stateRef.current = { boxes, activeId }; }, [boxes, activeId]);

  // Auto-size canvas for mobile
  useEffect(() => {
    function resize() {
      const mobile = isMobile();
      if (mobile) {
        const w = Math.min(window.innerWidth - 24, 600);
        const h = Math.round(w * (9/16)); // Instagram 9:16 ratio
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

  // Emit to parent
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
  }, [boxes, CANVAS_W, CANVAS_H]); // eslint-disable-line

  const updateBox = useCallback((id, patch) => {
    setBoxes(prev => prev.map(b => b.id === id ? { ...b, ...patch } : b));
  }, []);

  const activeBox = boxes.find(b => b.id === activeId) ?? boxes[0];

  const addBox = () => {
    const id = Date.now();
    setBoxes(prev => [...prev, makeBox({ id, text: 'New Text', posX: CANVAS_W/2, posY: CANVAS_H/2 })]);
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
    if (vid && vid.readyState >= 2) {
      try {
        // Draw video to fill canvas maintaining aspect ratio
        const vw = vid.videoWidth;
        const vh = vid.videoHeight;
        const vRatio = vw / vh;
        const cRatio = CANVAS_W / CANVAS_H;
        let drawW, drawH, offsetX = 0, offsetY = 0;
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

    // Grid (lighter, less distracting on mobile)
    const GRID = isMobile() ? 60 : 50;
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 0.5;
    for (let x = GRID; x < CANVAS_W; x += GRID) {
      ctx.beginPath(); ctx.moveTo(x,0); ctx.lineTo(x,CANVAS_H); ctx.stroke();
    }
    for (let y = GRID; y < CANVAS_H; y += GRID) {
      ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(CANVAS_W,y); ctx.stroke();
    }

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
        const pad   = isMobile() ? 20 : 12; // Bigger hit area on mobile
        ctx.strokeStyle = '#facc15'; ctx.lineWidth = isMobile() ? 2 : 1.5;
        ctx.setLineDash([6,4]);
        ctx.strokeRect(b.posX - maxTw/2 - pad, b.posY - totalH/2 - pad/2, maxTw + pad*2, totalH + pad);
        ctx.setLineDash([]);
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
    ctx.font = `bold ${box.fontSize}px ${box.font}`;
    const maxTw  = Math.max(...box.lines.map(l => ctx.measureText(l).width));
    const totalH = box.lines.length * box.fontSize * 1.3;
    const pad    = isMobile() ? 30 : 24; // Larger tap target on mobile
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
      updateBox(g.id, {
        posX: clamp(Math.round(g.startPX + (e.clientX - g.startCX)*(CANVAS_W/rect.width)), 30, CANVAS_W-30),
        posY: clamp(Math.round(g.startPY + (e.clientY - g.startCY)*(CANVAS_H/rect.height)), 30, CANVAS_H-30)
      });
    } else if (g.mode === 'pinch') {
      const pts = [...ptrsRef.current.values()];
      if (pts.length < 2) return;
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      updateBox(activeBox?.id, { fontSize: clamp(Math.round(g.startFontSize * dist / g.startDist), 16, 100) });
    }
  }

  function onPointerUp(e) {
    ptrsRef.current.delete(e.pointerId);
    if (ptrsRef.current.size === 0) gestureRef.current = null;
  }

  // ── RENDER ──────────────────────────────────────────────────────────────────
  const ab = activeBox;
  const mobile = isMobile();

  return (
    <div style={S.overlay}>
      {/* Mobile: simpler header */}
      <div style={mobile ? S.headerMobile : S.header}>
        <button onClick={onClose} style={S.closeBtn}>✕</button>
        <h1 style={mobile ? S.titleMobile : S.title}>Edit Text</h1>
        <button onClick={addBox} style={S.addBtnTop}>+</button>
      </div>

      {/* Canvas - full width on mobile */}
      <div style={mobile ? S.canvasWrapMobile : S.canvasWrap}>
        <canvas
          ref={canvasRef} width={CANVAS_W} height={CANVAS_H}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove}
          onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
          style={S.canvas}
        />
        {videoSrc && <video ref={videoRef} src={videoSrc} style={{ display:'none' }} loop playsInline muted autoPlay />}
        <p style={S.hint}>{mobile ? '👆 Drag • Pinch to resize' : '👆 Drag to move • 2 fingers to resize'}</p>
      </div>

      {/* Mobile: floating button to show/hide controls */}
      {mobile && (
        <button
          onClick={() => setShowControls(!showControls)}
          style={{ ...S.floatBtn, bottom: showControls ? '52%' : '20px' }}
        >
          {showControls ? '▼ Hide Controls' : '▲ Show Controls'}
        </button>
      )}

      {/* Controls - slide up panel on mobile */}
      <div style={mobile ? { ...S.panelMobile, transform: showControls ? 'translateY(0)' : 'translateY(100%)' } : S.cardWrap}>
        <div style={mobile ? S.cardMobile : S.card}>

          {/* Tabs */}
          {boxes.length > 1 && (
            <div style={S.tabs}>
              {boxes.map((b, i) => (
                <button key={b.id} onClick={() => setActiveId(b.id)}
                  style={{ ...S.tab, ...(b.id === activeId ? S.tabOn : {}) }}>
                  {i+1}
                </button>
              ))}
            </div>
          )}

          {/* LINES */}
          <Label text="TEXT LINES" />
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
              <div style={S.lineBtns}>
                <button onClick={() => splitLine(ab.id, li)} style={S.splitBtn} title="Split">↵</button>
                {li > 0 && <button onClick={() => mergeLine(ab.id, li)} style={S.mergeBtn} title="Join up">↑</button>}
                {ab.lines.length > 1 && (
                  <button onClick={() => { const lines = ab.lines.filter((_,i)=>i!==li); updateBox(ab.id,{lines}); }} style={S.delBtn}>✕</button>
                )}
              </div>
            </div>
          ))}

          <div style={S.div} />

          {/* Font size */}
          <Label text={`SIZE: ${ab?.fontSize ?? 36}`} />
          <input type="range" min={16} max={mobile ? 80 : 120} value={ab?.fontSize ?? 36}
            onChange={e => updateBox(ab.id, { fontSize: +e.target.value })} style={S.slider} />

          {/* Position sliders - simplified for mobile */}
          {!mobile && (
            <>
              <Label text={`POSITION  X: ${ab?.posX ?? 0}  Y: ${ab?.posY ?? 0}`} />
              <div style={{ display:'flex', gap:10 }}>
                <input type="range" min={0} max={CANVAS_W} value={ab?.posX ?? 0}
                  onChange={e => updateBox(ab.id, { posX: +e.target.value })} style={{ ...S.slider, flex:1 }} />
                <input type="range" min={0} max={CANVAS_H} value={ab?.posY ?? 0}
                  onChange={e => updateBox(ab.id, { posY: +e.target.value })} style={{ ...S.slider, flex:1 }} />
              </div>
            </>
          )}

          <div style={S.div} />

          {/* Font */}
          <Label text="FONT" />
          <select value={ab?.font ?? 'Arial'} onChange={e => updateBox(ab.id, { font: e.target.value })} style={S.select}>
            {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
          </select>

          {/* Color */}
          <Label text="COLOR" />
          <div style={S.swatches}>
            {COLORS.map(c => (
              <button key={c} onClick={() => updateBox(ab.id, { textColor: c })}
                style={{ ...S.swatch, background:c, outline: ab?.textColor===c ? '3px solid #facc15' : '2px solid rgba(0,0,0,0.15)' }} />
            ))}
            <input type="color" value={ab?.textColor ?? '#ffffff'} onChange={e => updateBox(ab.id, { textColor: e.target.value })} style={S.cpick} />
          </div>

          {/* Background */}
          <Label text="BACKGROUND" />
          <div style={S.bgRow}>
            {[{v:'none',l:'None'},{v:'dark',l:'Dark'},{v:'black',l:'Black'},{v:'light',l:'Light'},{v:'white',l:'White'}].map(o => (
              <button key={o.v} onClick={() => updateBox(ab.id, { bg: o.v })}
                style={{ ...S.bgBtn, background: ab?.bg===o.v?'#1a1a3a':'#111', border: ab?.bg===o.v?'1.5px solid #7b6fff':'1px solid #2a2a2a', color: ab?.bg===o.v?'#7b6fff':'#888' }}>
                {o.l}
              </button>
            ))}
          </div>

          <div style={S.div} />

          {/* Action buttons */}
          <div style={{ display:'flex', gap: 8 }}>
            <button onClick={() => removeBox(ab.id)} style={S.removeBtn}>🗑 Delete</button>
            <button onClick={onClose} style={S.doneBtn}>✓ Done</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Label({ text }) {
  return <div style={{ fontSize:10, fontWeight:700, color:'#9ca3af', letterSpacing:'0.07em', textTransform:'uppercase', margin:'10px 0 6px' }}>{text}</div>;
}

const S = {
  overlay: { position:'fixed', inset:0, zIndex:9999, background:'#0a0a0a', display:'flex', flexDirection:'column', fontFamily:'-apple-system,BlinkMacSystemFont,"SF Pro Display",sans-serif', overflow:'hidden' },

  // Header
  header: { padding:'16px 20px', display:'flex', justifyContent:'space-between', alignItems:'center', borderBottom:'1px solid #1a1a1a', flexShrink:0 },
  headerMobile: { padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center', background:'#111', borderBottom:'1px solid #222', flexShrink:0 },
  title: { fontSize:24, fontWeight:700, color:'#e5e5e5', margin:0 },
  titleMobile: { fontSize:18, fontWeight:700, color:'#e5e5e5', margin:0, flex:1, textAlign:'center' },
  closeBtn: { background:'transparent', border:'none', color:'#888', fontSize:28, cursor:'pointer', padding:0, width:32, height:32, display:'flex', alignItems:'center', justifyContent:'center' },
  addBtnTop: { background:'#7b6fff', border:'none', borderRadius:8, color:'#fff', fontSize:20, cursor:'pointer', width:36, height:36, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:700 },

  // Canvas
  canvasWrap: { padding:'20px', flexShrink:0, display:'flex', flexDirection:'column', alignItems:'center' },
  canvasWrapMobile: { padding:'12px 12px 0', flexShrink:0, display:'flex', flexDirection:'column', alignItems:'center', flex:1 },
  canvas: { width:'100%', display:'block', touchAction:'none', borderRadius:12, border:'1px solid #222', cursor:'crosshair', boxShadow:'0 4px 20px rgba(0,0,0,0.5)' },
  hint: { textAlign:'center', fontSize:12, color:'#666', marginTop:8, fontWeight:500 },

  // Floating button (mobile only)
  floatBtn: { position:'fixed', left:'50%', transform:'translateX(-50%)', zIndex:10000, background:'linear-gradient(135deg,#7b6fff,#5a4fd6)', border:'none', borderRadius:20, color:'#fff', padding:'10px 24px', fontSize:13, fontWeight:700, cursor:'pointer', boxShadow:'0 4px 16px rgba(123,111,255,0.4)', transition:'bottom 0.3s ease' },

  // Control panel
  cardWrap: { padding:'0 20px 30px', flexShrink:0, overflowY:'auto' },
  panelMobile: { position:'fixed', bottom:0, left:0, right:0, maxHeight:'50vh', background:'#111', borderTopLeftRadius:20, borderTopRightRadius:20, boxShadow:'0 -4px 20px rgba(0,0,0,0.6)', transition:'transform 0.3s ease', overflowY:'auto', zIndex:9998 },
  card: { maxWidth:700, margin:'0 auto', background:'#111', border:'1px solid #222', borderRadius:12, padding:'18px' },
  cardMobile: { padding:'20px 16px 28px', background:'#111' },

  // Tabs
  tabs: { display:'flex', gap:6, marginBottom:14, flexWrap:'wrap', justifyContent:'center' },
  tab: { padding:'7px 16px', borderRadius:8, fontSize:13, fontWeight:700, cursor:'pointer', background:'#1a1a1a', border:'1px solid #2a2a2a', color:'#888', minWidth:44 },
  tabOn: { background:'#7b6fff', border:'1px solid #7b6fff', color:'#fff' },

  // Lines
  lineRow: { display:'flex', alignItems:'center', gap:5, marginBottom:6 },
  lineInput: { flex:1, padding:'10px 12px', border:'1.5px solid #2a2a2a', borderRadius:8, fontSize:15, fontFamily:'inherit', color:'#fff', background:'#0a0a0a', outline:'none', resize:'none', lineHeight:1.3 },
  lineBtns: { display:'flex', gap:4, flexShrink:0 },
  splitBtn: { padding:'6px 9px', borderRadius:6, fontSize:13, fontWeight:700, cursor:'pointer', border:'1.5px solid #2563eb', background:'#0a1628', color:'#60a5fa', whiteSpace:'nowrap', flexShrink:0 },
  mergeBtn: { padding:'6px 9px', borderRadius:6, fontSize:13, fontWeight:700, cursor:'pointer', border:'1.5px solid #d97706', background:'#1a1308', color:'#fbbf24', whiteSpace:'nowrap', flexShrink:0 },
  delBtn: { padding:'6px 8px', borderRadius:6, fontSize:13, fontWeight:700, cursor:'pointer', border:'1.5px solid #dc2626', background:'#1a0808', color:'#f87171', flexShrink:0 },

  div: { height:1, background:'#222', margin:'12px 0' },

  // Controls
  slider: { width:'100%', height:6, accentColor:'#7b6fff', cursor:'pointer', display:'block', marginBottom:4 },
  select: { width:'100%', padding:'11px 12px', border:'1.5px solid #2a2a2a', borderRadius:8, fontSize:14, background:'#0a0a0a', color:'#fff', cursor:'pointer', outline:'none', marginBottom:4 },
  swatches: { display:'flex', gap:8, flexWrap:'wrap', alignItems:'center', marginBottom:4 },
  swatch: { width:32, height:32, borderRadius:'50%', cursor:'pointer', border:'none', padding:0, flexShrink:0 },
  cpick: { width:40, height:32, border:'1.5px solid #2a2a2a', borderRadius:8, cursor:'pointer', padding:2, background:'#0a0a0a' },
  bgRow: { display:'flex', gap:6, flexWrap:'wrap', marginBottom:4 },
  bgBtn: { padding:'8px 14px', borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer', flex:1, minWidth:70, textAlign:'center' },

  // Action buttons
  removeBtn: { flex:1, padding:12, background:'#1a0808', border:'1.5px solid #dc2626', borderRadius:8, color:'#f87171', fontSize:14, fontWeight:600, cursor:'pointer' },
  doneBtn: { flex:2, padding:12, background:'linear-gradient(135deg,#7b6fff,#5a4fd6)', border:'none', borderRadius:8, color:'#fff', fontSize:14, fontWeight:700, cursor:'pointer' },
};
