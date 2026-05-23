import React, { useState, useEffect, useRef, useCallback } from 'react';

const FONTS  = ['Arial','Helvetica Neue','Georgia','Impact','Courier New'];
const COLORS = ['#FFFFFF','#000000','#FF3B30','#FF9500','#FFCC00','#34C759','#007AFF','#5856D6','#FF2D55'];

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export default function TextOverlayEditor({ videoSrc, textBoxes, onChange, onClose }) {

  // ── Internal canvas resolution: fixed 1080×1920 (9:16)
  // This is the coordinate space for ALL text positions.
  // The canvas CSS scales to fit the screen — but positions are always in 1080×1920 space.
  const CW = 1080;
  const CH = 1920;

  const makeBox = (raw) => {
    const rawText = raw?.text || '';
    return {
      id:        raw?.id        ?? Date.now(),
      lines:     rawText ? rawText.split('\n') : ['Your Text'],
      fontSize:  raw?.fontSize  ?? 80,
      posX:      raw?.posX      ?? (raw?.xPct != null ? Math.round((raw.xPct/100)*CW) : CW/2),
      posY:      raw?.posY      ?? (raw?.yPct != null ? Math.round((raw.yPct/100)*CH) : CH/2),
      font:      raw?.font      ?? 'Arial',
      textColor: raw?.textColor ?? raw?.colorHex ?? '#FFFFFF',
      bg:        raw?.bg        ?? 'none',
    };
  };

  const [boxes,     setBoxes]     = useState(() => textBoxes?.length ? textBoxes.map(makeBox) : [makeBox(null)]);
  const [activeId,  setActiveId]  = useState(() => textBoxes?.[0]?.id ?? boxes[0]?.id);
  const [showPanel, setShowPanel] = useState(false);

  // Track the canvas's displayed size on screen (for gesture math)
  const [displayRect, setDisplayRect] = useState({ x:0, y:0, w: window.innerWidth, h: window.innerHeight });

  const canvasRef  = useRef(null);
  const videoRef   = useRef(null);
  const wrapRef    = useRef(null);
  const gestureRef = useRef(null);
  const ptrsRef    = useRef(new Map());
  const stateRef   = useRef({ boxes, activeId });

  useEffect(() => { stateRef.current = { boxes, activeId }; }, [boxes, activeId]);

  // Measure the canvas wrapper so we know how the 1080×1920 maps to screen pixels
  useEffect(() => {
    function measure() {
      const el = wrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setDisplayRect({ x: r.left, y: r.top, w: r.width, h: r.height });
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Emit to parent
  useEffect(() => {
    const out = boxes.map(b => ({
      id: b.id, text: b.lines.join('\n'),
      fontSize: b.fontSize, posX: b.posX, posY: b.posY,
      font: b.font, textColor: b.textColor, colorHex: b.textColor,
      xPct: (b.posX / CW) * 100, yPct: (b.posY / CH) * 100,
      bg: b.bg, align: 'center', widthPct: 80,
    }));
    onChange(out.filter(b => b.text.trim()));
  }, [boxes]); // eslint-disable-line

  const updateBox = useCallback((id, patch) => {
    setBoxes(prev => prev.map(b => b.id === id ? { ...b, ...patch } : b));
  }, []);

  const activeBox = boxes.find(b => b.id === activeId) ?? boxes[0];

  const addBox = () => {
    const id = Date.now();
    const nb = makeBox({ id, text: 'New Text', posX: CW/2, posY: CH/3 });
    setBoxes(prev => [...prev, nb]);
    setActiveId(id);
    setShowPanel(true);
  };

  const removeBox = (id) => {
    setBoxes(prev => {
      const n = prev.filter(b => b.id !== id);
      return n.length ? n : [makeBox(null)];
    });
    setActiveId(boxes.find(b => b.id !== id)?.id ?? boxes[0]?.id);
  };

  const splitLine = (id, li, charIdx) => {
    setBoxes(prev => prev.map(b => {
      if (b.id !== id) return b;
      const lines = [...b.lines];
      const line  = lines[li] ?? '';
      let at = charIdx;
      if (at == null) {
        const mid = Math.floor(line.length / 2);
        at = line.lastIndexOf(' ', mid);
        if (at <= 0) at = line.indexOf(' ', mid);
        if (at <= 0) at = mid;
      }
      lines.splice(li, 1, line.slice(0, at).trimEnd() || ' ', line.slice(at).trimStart() || ' ');
      return { ...b, lines };
    }));
  };

  const mergeLine = (id, li) => {
    if (li === 0) return;
    setBoxes(prev => prev.map(b => {
      if (b.id !== id) return b;
      const lines = [...b.lines];
      lines[li-1] = (lines[li-1] + ' ' + lines[li]).trim();
      lines.splice(li, 1);
      return { ...b, lines };
    }));
  };

  const updateLine = (id, li, value) => {
    setBoxes(prev => prev.map(b => {
      if (b.id !== id) return b;
      const lines = [...b.lines];
      lines[li] = value;
      return { ...b, lines };
    }));
  };

  // ── DRAW ──────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { boxes, activeId } = stateRef.current;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CW, CH);

    const vid = videoRef.current;
    if (vid && vid.readyState >= 2) {
      try {
        const vw = vid.videoWidth  || CW;
        const vh = vid.videoHeight || CH;
        const vRatio = vw / vh;
        const cRatio = CW / CH;

        let dw, dh, dx = 0, dy = 0;
        // CONTAIN mode: show full video, no crop, letterbox if needed
        if (vRatio > cRatio) {
          dw = CW;
          dh = CW / vRatio;
          dy = (CH - dh) / 2;
        } else {
          dh = CH;
          dw = CH * vRatio;
          dx = (CW - dw) / 2;
        }
        ctx.drawImage(vid, dx, dy, dw, dh);
      } catch (_) {}
    }

    // Text overlays
    boxes.forEach(b => {
      const isActive = b.id === activeId;
      const lineH    = b.fontSize * 1.3;
      const totalH   = b.lines.length * lineH;
      const startY   = b.posY - totalH / 2 + lineH / 2;

      ctx.font         = `700 ${b.fontSize}px ${b.font}, Arial, sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';

      b.lines.forEach((line, i) => {
        const ly  = startY + i * lineH;
        const tw  = ctx.measureText(line).width;
        const pad = 16;

        if (b.bg !== 'none') {
          ctx.fillStyle =
            b.bg === 'black' ? 'rgba(0,0,0,0.82)' :
            b.bg === 'dark'  ? 'rgba(0,0,0,0.60)' :
            b.bg === 'white' ? 'rgba(255,255,255,0.92)' :
            'rgba(255,255,255,0.70)';
          ctx.beginPath();
          ctx.roundRect(b.posX - tw/2 - pad, ly - b.fontSize/2 - 8, tw + pad*2, b.fontSize + 16, 10);
          ctx.fill();
        }

        // No shadow — clean flat text
        ctx.fillStyle = b.textColor;
        ctx.fillText(line, b.posX, ly);
      });

      if (isActive) {
        const maxTw = Math.max(...b.lines.map(l => ctx.measureText(l).width));
        const pad   = 32;
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth   = 3;
        ctx.setLineDash([10, 6]);
        ctx.strokeRect(
          b.posX - maxTw/2 - pad,
          b.posY - totalH/2 - pad/2,
          maxTw + pad*2,
          totalH + pad
        );
        ctx.setLineDash([]);
      }
    });
  }, [CW, CH]);

  useEffect(() => {
    let raf;
    const loop = () => { draw(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [draw]);

  // ── GESTURES — convert screen pixels → 1080×1920 space ───────────────────
  function screenToCanvas(screenX, screenY) {
    const scaleX = CW / displayRect.w;
    const scaleY = CH / displayRect.h;
    return {
      cx: (screenX - displayRect.x) * scaleX,
      cy: (screenY - displayRect.y) * scaleY,
    };
  }

  function hitTest(box, cx, cy) {
    if (!box || !canvasRef.current) return false;
    const ctx = canvasRef.current.getContext('2d');
    ctx.font = `700 ${box.fontSize}px ${box.font}`;
    const maxTw  = Math.max(...box.lines.map(l => ctx.measureText(l).width));
    const totalH = box.lines.length * box.fontSize * 1.3;
    const pad    = 60;
    return cx >= box.posX - maxTw/2 - pad && cx <= box.posX + maxTw/2 + pad &&
           cy >= box.posY - totalH/2 - pad && cy <= box.posY + totalH/2 + pad;
  }

  function onPointerDown(e) {
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
    ptrsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (ptrsRef.current.size >= 2) {
      const pts  = [...ptrsRef.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const box  = stateRef.current.boxes.find(b => b.id === stateRef.current.activeId);
      gestureRef.current = { mode: 'pinch', startDist: dist, startFontSize: box?.fontSize ?? 80 };
      return;
    }

    const { cx, cy } = screenToCanvas(e.clientX, e.clientY);
    const { boxes }  = stateRef.current;
    for (let i = boxes.length - 1; i >= 0; i--) {
      if (hitTest(boxes[i], cx, cy)) {
        setActiveId(boxes[i].id);
        gestureRef.current = {
          mode: 'drag',
          startScreenX: e.clientX, startScreenY: e.clientY,
          startPX: boxes[i].posX,  startPY: boxes[i].posY,
          id: boxes[i].id,
        };
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
      const scaleX = CW / displayRect.w;
      const scaleY = CH / displayRect.h;
      updateBox(g.id, {
        posX: clamp(Math.round(g.startPX + (e.clientX - g.startScreenX) * scaleX), 50, CW - 50),
        posY: clamp(Math.round(g.startPY + (e.clientY - g.startScreenY) * scaleY), 50, CH - 50),
      });
    } else if (g.mode === 'pinch') {
      const pts  = [...ptrsRef.current.values()];
      if (pts.length < 2) return;
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      updateBox(activeBox?.id, {
        fontSize: clamp(Math.round(g.startFontSize * dist / g.startDist), 30, 200),
      });
    }
  }

  function onPointerUp(e) {
    ptrsRef.current.delete(e.pointerId);
    if (ptrsRef.current.size === 0) gestureRef.current = null;
  }

  const ab = activeBox;

  return (
    <div style={S.root}>
      {/* Hidden video */}
      {videoSrc && (
        <video ref={videoRef} src={videoSrc} style={{ display:'none' }} loop playsInline muted autoPlay />
      )}

      {/* Top bar */}
      <div style={S.topBar}>
        <button onClick={onClose} style={S.topBtn}>✓ Done</button>
        <span style={S.topHint}>Drag text · Pinch to resize</span>
        <button onClick={addBox} style={{ ...S.topBtn, color:'#a78bfa' }}>+ Text</button>
      </div>

      {/* Canvas — fills remaining screen in 9:16 ratio */}
      <div ref={wrapRef} style={S.canvasWrap}>
        <canvas
          ref={canvasRef} width={CW} height={CH}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={S.canvas}
        />
      </div>

      {/* Toggle button */}
      <button
        onClick={() => setShowPanel(p => !p)}
        style={{ ...S.toggleBtn, bottom: showPanel ? 'calc(52vh + 10px)' : '16px' }}
      >
        {showPanel ? '↓ Hide' : '✎ Edit Text'}
      </button>

      {/* Slide-up panel */}
      <div style={{ ...S.panel, transform: showPanel ? 'translateY(0)' : 'translateY(100%)' }}>

        {/* Handle bar */}
        <div style={S.handle} />

        {/* Multi-text tabs */}
        {boxes.length > 1 && (
          <div style={S.tabs}>
            {boxes.map((b, i) => (
              <button key={b.id} onClick={() => setActiveId(b.id)}
                style={b.id === activeId ? S.tabOn : S.tab}>
                Text {i+1}
              </button>
            ))}
          </div>
        )}

        {/* Text lines */}
        <div style={S.secLabel}>TEXT LINES</div>
        {ab?.lines.map((line, li) => (
          <div key={li} style={S.lineRow}>
            <input
              value={line}
              onChange={e => updateLine(ab.id, li, e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); splitLine(ab.id, li, e.currentTarget.selectionStart); }
                if (e.key === 'Backspace' && e.currentTarget.selectionStart === 0 && li > 0) { e.preventDefault(); mergeLine(ab.id, li); }
              }}
              style={S.lineInput}
              placeholder={`Line ${li+1}`}
            />
            <button onClick={() => splitLine(ab.id, li)} style={S.splitBtn}>↵</button>
            {li > 0 && <button onClick={() => mergeLine(ab.id, li)} style={S.joinBtn}>↑</button>}
            {ab.lines.length > 1 && (
              <button onClick={() => updateBox(ab.id, { lines: ab.lines.filter((_,i)=>i!==li) })} style={S.xBtn}>✕</button>
            )}
          </div>
        ))}

        <div style={S.divider} />

        {/* Size */}
        <div style={S.secLabel}>SIZE — {ab?.fontSize ?? 80}PX</div>
        <input type="range" min={30} max={200} value={ab?.fontSize ?? 80}
          onChange={e => updateBox(ab.id, { fontSize: +e.target.value })} style={S.slider} />

        <div style={S.divider} />

        {/* Font */}
        <div style={S.secLabel}>FONT</div>
        <select value={ab?.font ?? 'Arial'} onChange={e => updateBox(ab.id, { font: e.target.value })} style={S.select}>
          {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
        </select>

        {/* Color */}
        <div style={{ ...S.secLabel, marginTop: 14 }}>COLOR</div>
        <div style={S.colorRow}>
          {COLORS.map(c => (
            <button key={c} onClick={() => updateBox(ab.id, { textColor: c })}
              style={{ ...S.colorDot, background: c, boxShadow: ab?.textColor === c ? `0 0 0 3px #fff, 0 0 0 5px ${c}` : 'none' }} />
          ))}
          <input type="color" value={ab?.textColor ?? '#FFFFFF'}
            onChange={e => updateBox(ab.id, { textColor: e.target.value })} style={S.colorPicker} />
        </div>

        {/* Background */}
        <div style={{ ...S.secLabel, marginTop: 14 }}>BACKGROUND</div>
        <div style={S.bgRow}>
          {[{v:'none',l:'None'},{v:'dark',l:'Dark'},{v:'black',l:'Black'},{v:'white',l:'White'}].map(o => (
            <button key={o.v} onClick={() => updateBox(ab.id, { bg: o.v })}
              style={ab?.bg === o.v ? S.bgOn : S.bgOff}>
              {o.l}
            </button>
          ))}
        </div>

        <div style={S.divider} />

        {/* Actions */}
        <div style={S.actRow}>
          <button onClick={() => removeBox(ab.id)} style={S.delBtn}>Delete Text</button>
          <button onClick={onClose} style={S.doneBtn}>✓ Done</button>
        </div>
      </div>
    </div>
  );
}

const S = {
  root:       { position:'fixed', inset:0, zIndex:9999, background:'#000', display:'flex', flexDirection:'column', fontFamily:'-apple-system,BlinkMacSystemFont,Arial,sans-serif', overflow:'hidden' },

  topBar:     { flexShrink:0, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 18px', paddingTop:'calc(10px + env(safe-area-inset-top,0px))', background:'rgba(0,0,0,0.7)', backdropFilter:'blur(10px)' },
  topBtn:     { background:'transparent', border:'none', color:'#fff', fontSize:16, fontWeight:700, cursor:'pointer', padding:'6px 0' },
  topHint:    { fontSize:12, color:'rgba(255,255,255,0.4)', textAlign:'center' },

  // Canvas wrapper: fills all space between topBar and bottom, maintains 9:16
  canvasWrap: { flex:1, display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden', background:'#000' },
  canvas:     { display:'block', width:'auto', height:'100%', maxWidth:'100%', maxHeight:'100%', touchAction:'none', objectFit:'contain' },

  toggleBtn:  { position:'fixed', left:'50%', transform:'translateX(-50%)', zIndex:10001, background:'linear-gradient(135deg,#7c3aed,#a855f7)', border:'none', borderRadius:24, color:'#fff', padding:'12px 32px', fontSize:14, fontWeight:700, cursor:'pointer', transition:'bottom 0.25s ease', boxShadow:'0 4px 20px rgba(124,58,237,0.5)', whiteSpace:'nowrap' },

  panel:      { position:'fixed', bottom:0, left:0, right:0, height:'52vh', background:'rgba(10,10,20,0.97)', backdropFilter:'blur(30px)', borderTopLeftRadius:22, borderTopRightRadius:22, padding:'12px 18px 32px', overflowY:'auto', transition:'transform 0.28s cubic-bezier(0.4,0,0.2,1)', zIndex:10000 },
  handle:     { width:36, height:4, background:'rgba(255,255,255,0.2)', borderRadius:4, margin:'0 auto 16px' },

  tabs:       { display:'flex', gap:8, marginBottom:16 },
  tab:        { padding:'8px 16px', borderRadius:20, border:'1px solid rgba(255,255,255,0.1)', background:'transparent', color:'#888', fontSize:13, fontWeight:600, cursor:'pointer' },
  tabOn:      { padding:'8px 16px', borderRadius:20, border:'none', background:'#7c3aed', color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer' },

  secLabel:   { fontSize:10, fontWeight:700, color:'#555', letterSpacing:'0.08em', marginBottom:8 },
  divider:    { height:1, background:'rgba(255,255,255,0.07)', margin:'14px 0' },

  lineRow:    { display:'flex', gap:6, marginBottom:8, alignItems:'center' },
  lineInput:  { flex:1, padding:'10px 12px', background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:10, color:'#fff', fontSize:15, fontFamily:'inherit', outline:'none' },
  splitBtn:   { padding:'9px 12px', borderRadius:8, border:'none', background:'rgba(99,102,241,0.2)', color:'#818cf8', fontSize:14, fontWeight:700, cursor:'pointer', flexShrink:0 },
  joinBtn:    { padding:'9px 12px', borderRadius:8, border:'none', background:'rgba(245,158,11,0.15)', color:'#fbbf24', fontSize:14, fontWeight:700, cursor:'pointer', flexShrink:0 },
  xBtn:       { padding:'9px 10px', borderRadius:8, border:'none', background:'rgba(239,68,68,0.15)', color:'#f87171', fontSize:14, cursor:'pointer', flexShrink:0 },

  slider:     { width:'100%', accentColor:'#7c3aed', cursor:'pointer', display:'block' },
  select:     { width:'100%', padding:'11px 12px', background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:10, color:'#fff', fontSize:15, cursor:'pointer', outline:'none', fontFamily:'inherit' },

  colorRow:   { display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' },
  colorDot:   { width:34, height:34, borderRadius:'50%', border:'none', cursor:'pointer', flexShrink:0, padding:0, transition:'box-shadow 0.15s' },
  colorPicker:{ width:42, height:34, border:'1px solid rgba(255,255,255,0.1)', borderRadius:8, cursor:'pointer', padding:2, background:'rgba(255,255,255,0.06)' },

  bgRow:      { display:'flex', gap:8 },
  bgOff:      { flex:1, padding:'10px 0', borderRadius:10, border:'1px solid rgba(255,255,255,0.1)', background:'transparent', color:'#888', fontSize:13, fontWeight:600, cursor:'pointer', textAlign:'center' },
  bgOn:       { flex:1, padding:'10px 0', borderRadius:10, border:'none', background:'#7c3aed', color:'#fff', fontSize:13, fontWeight:700, cursor:'pointer', textAlign:'center' },

  actRow:     { display:'flex', gap:10, marginTop:4 },
  delBtn:     { flex:1, padding:'13px', borderRadius:12, border:'none', background:'rgba(239,68,68,0.12)', color:'#f87171', fontSize:14, fontWeight:600, cursor:'pointer' },
  doneBtn:    { flex:2, padding:'13px', borderRadius:12, border:'none', background:'linear-gradient(135deg,#7c3aed,#a855f7)', color:'#fff', fontSize:14, fontWeight:700, cursor:'pointer' },
};
