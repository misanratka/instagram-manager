import React, { useState, useEffect, useRef, useCallback } from 'react';

const CW = 1080;
const CH = 1920;
const FONTS = [
  { label: 'Default',  value: 'Arial' },
  { label: 'Serif',    value: 'Georgia' },
  { label: 'Impact',   value: 'Impact' },
  { label: 'Mono',     value: 'Courier New' },
  { label: 'Thin',     value: 'Helvetica Neue' },
];

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

export default function TextOverlayEditor({ videoSrc, textBoxes, onChange, onClose }) {

  const makeBox = (raw) => ({
    id:        raw?.id        ?? Date.now(),
    lines:     raw?.text      ? raw.text.split('\n') : ['Tap to type'],
    fontSize:  raw?.fontSize  ?? 90,
    posX:      raw?.posX      ?? (raw?.xPct != null ? Math.round((raw.xPct/100)*CW) : CW/2),
    posY:      raw?.posY      ?? (raw?.yPct != null ? Math.round((raw.yPct/100)*CH) : CH*0.45),
    font:      raw?.font      ?? 'Arial',
    textColor: raw?.textColor ?? '#FFFFFF',
    bg:        raw?.bg        ?? 'none',
    align:     raw?.align     ?? 'center',
  });

  const [boxes,     setBoxes]     = useState(() => textBoxes?.length ? textBoxes.map(makeBox) : [makeBox(null)]);
  const [activeId,  setActiveId]  = useState(() => textBoxes?.[0]?.id ?? boxes[0]?.id);
  const [typing,    setTyping]    = useState(false);   // keyboard open
  const [activeTab, setActiveTab] = useState('color'); // bottom toolbar tab
  const [kbHeight,  setKbHeight]  = useState(0);       // keyboard height estimate

  const canvasRef  = useRef(null);
  const videoRef   = useRef(null);
  const wrapRef    = useRef(null);
  const inputRef   = useRef(null);
  const gestureRef = useRef(null);
  const ptrsRef    = useRef(new Map());
  const stateRef   = useRef({ boxes, activeId });
  const [dispRect, setDispRect] = useState({ x:0, y:0, w:1, h:1 });

  useEffect(() => { stateRef.current = { boxes, activeId }; }, [boxes, activeId]);

  // Measure canvas display rect
  useEffect(() => {
    function measure() {
      const r = wrapRef.current?.getBoundingClientRect();
      if (r) setDispRect({ x:r.left, y:r.top, w:r.width, h:r.height });
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Detect keyboard height via viewport resize
  useEffect(() => {
    function onResize() {
      if (window.visualViewport) {
        const kh = window.innerHeight - window.visualViewport.height;
        setKbHeight(kh > 50 ? kh : 0);
      }
    }
    window.visualViewport?.addEventListener('resize', onResize);
    return () => window.visualViewport?.removeEventListener('resize', onResize);
  }, []);

  // Emit to parent
  useEffect(() => {
    const out = boxes.map(b => ({
      id: b.id, text: b.lines.join('\n'),
      fontSize: b.fontSize, posX: b.posX, posY: b.posY,
      font: b.font, textColor: b.textColor, colorHex: b.textColor,
      xPct: (b.posX/CW)*100, yPct: (b.posY/CH)*100,
      bg: b.bg, align: b.align ?? 'center', widthPct: 80,
    }));
    onChange(out.filter(b => b.text.trim() && b.text !== 'Tap to type'));
  }, [boxes]); // eslint-disable-line

  const updateBox = useCallback((id, patch) => {
    setBoxes(prev => prev.map(b => b.id === id ? { ...b, ...patch } : b));
  }, []);

  const ab = boxes.find(b => b.id === activeId) ?? boxes[0];

  // ── Text helpers ──────────────────────────────────────────────────────────
  const addBox = () => {
    const id = Date.now();
    setBoxes(prev => [...prev, makeBox({ id, posX: CW/2, posY: CH*0.45 })]);
    setActiveId(id);
    setTimeout(() => { setTyping(true); inputRef.current?.focus(); }, 50);
  };

  const removeActive = () => {
    setBoxes(prev => {
      const n = prev.filter(b => b.id !== activeId);
      return n.length ? n : [makeBox(null)];
    });
    setActiveId(boxes.find(b => b.id !== activeId)?.id ?? boxes[0]?.id);
    setTyping(false);
  };

  // The typing input value = all lines joined by newline
  const inputValue = ab?.lines.join('\n') ?? '';

  const handleInputChange = (e) => {
    const val = e.target.value;
    updateBox(ab.id, { lines: val.split('\n') });
  };

  // Split at cursor — triggered by custom Split button
  const handleSplit = () => {
    const el = inputRef.current;
    if (!el) return;
    const cursor = el.selectionStart;
    const val    = el.value;
    const before = val.slice(0, cursor);
    const after  = val.slice(cursor);
    const newVal = before + '\n' + after;
    updateBox(ab.id, { lines: newVal.split('\n') });
    // Restore cursor after the newline
    setTimeout(() => {
      el.selectionStart = el.selectionEnd = cursor + 1;
    }, 10);
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
        const vw = vid.videoWidth||CW, vh = vid.videoHeight||CH;
        const vR = vw/vh, cR = CW/CH;
        let dw, dh, dx=0, dy=0;
        if (vR > cR) { dw=CW; dh=CW/vR; dy=(CH-dh)/2; }
        else         { dh=CH; dw=CH*vR; dx=(CW-dw)/2; }
        ctx.drawImage(vid, dx, dy, dw, dh);
      } catch(_) {}
    }

    boxes.forEach(b => {
      const isActive = b.id === activeId;
      const lineH    = b.fontSize * 1.35;
      const totalH   = b.lines.length * lineH;
      const startY   = b.posY - totalH/2 + lineH/2;

      ctx.font         = `700 ${b.fontSize}px "${b.font}", Arial`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';

      b.lines.forEach((line, i) => {
        const ly  = startY + i * lineH;
        const tw  = ctx.measureText(line).width;
        const pad = 20;

        // Hard solid background
        if (b.bg === 'black') {
          ctx.fillStyle = '#000000';
          ctx.beginPath(); ctx.roundRect(b.posX-tw/2-pad, ly-b.fontSize/2-12, tw+pad*2, b.fontSize+24, 8); ctx.fill();
        } else if (b.bg === 'white') {
          ctx.fillStyle = '#FFFFFF';
          ctx.beginPath(); ctx.roundRect(b.posX-tw/2-pad, ly-b.fontSize/2-12, tw+pad*2, b.fontSize+24, 8); ctx.fill();
        }

        // Flat text — ZERO shadow
        ctx.fillStyle = b.textColor;
        ctx.fillText(line, b.posX, ly);
      });

      // Selection ring
      if (isActive) {
        const maxTw = Math.max(...b.lines.map(l => ctx.measureText(l).width));
        const pad   = 44;
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth   = 5;
        ctx.setLineDash([14, 8]);
        ctx.strokeRect(b.posX-maxTw/2-pad, b.posY-totalH/2-pad/2, maxTw+pad*2, totalH+pad);
        ctx.setLineDash([]);

        // Corner handles
        const hx = [b.posX-maxTw/2-pad, b.posX+maxTw/2+pad];
        const hy = [b.posY-totalH/2-pad/2, b.posY+totalH/2+pad/2];
        ctx.fillStyle = '#FFFFFF';
        hx.forEach(x => hy.forEach(y => {
          ctx.beginPath(); ctx.arc(x, y, 14, 0, Math.PI*2); ctx.fill();
        }));
      }
    });
  }, []);

  useEffect(() => {
    let raf;
    const loop = () => { draw(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [draw]);

  // ── GESTURES ──────────────────────────────────────────────────────────────
  function s2c(sx, sy) {
    return { cx:(sx-dispRect.x)*(CW/dispRect.w), cy:(sy-dispRect.y)*(CH/dispRect.h) };
  }

  function hitTest(box, cx, cy) {
    if (!box || !canvasRef.current) return false;
    const ctx = canvasRef.current.getContext('2d');
    ctx.font = `700 ${box.fontSize}px "${box.font}"`;
    const maxTw  = Math.max(...box.lines.map(l => ctx.measureText(l).width));
    const totalH = box.lines.length * box.fontSize * 1.35;
    const pad    = 80;
    return cx >= box.posX-maxTw/2-pad && cx <= box.posX+maxTw/2+pad &&
           cy >= box.posY-totalH/2-pad && cy <= box.posY+totalH/2+pad;
  }

  function onPtrDown(e) {
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch(_) {}
    ptrsRef.current.set(e.pointerId, { x:e.clientX, y:e.clientY });

    // Pinch
    if (ptrsRef.current.size >= 2) {
      const pts  = [...ptrsRef.current.values()];
      const dist = Math.hypot(pts[0].x-pts[1].x, pts[0].y-pts[1].y);
      const box  = stateRef.current.boxes.find(b => b.id===stateRef.current.activeId);
      gestureRef.current = { mode:'pinch', startDist:dist, startFS:box?.fontSize??90 };
      return;
    }

    const { cx, cy } = s2c(e.clientX, e.clientY);
    for (let i = stateRef.current.boxes.length-1; i >= 0; i--) {
      const box = stateRef.current.boxes[i];
      if (hitTest(box, cx, cy)) {
        setActiveId(box.id);
        gestureRef.current = { mode:'drag', sx:e.clientX, sy:e.clientY, px:box.posX, py:box.posY, id:box.id, moved:false };
        return;
      }
    }
    // Tapped empty area — dismiss typing
    setTyping(false);
    inputRef.current?.blur();
    gestureRef.current = null;
  }

  function onPtrMove(e) {
    const ptr = ptrsRef.current.get(e.pointerId);
    if (ptr) { ptr.x=e.clientX; ptr.y=e.clientY; }
    const g = gestureRef.current;
    if (!g) return;

    if (g.mode === 'drag') {
      const dx = e.clientX - g.sx, dy = e.clientY - g.sy;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) g.moved = true;
      if (!g.moved) return;
      const scX = CW/dispRect.w, scY = CH/dispRect.h;
      updateBox(g.id, {
        posX: clamp(Math.round(g.px + dx*scX), 60, CW-60),
        posY: clamp(Math.round(g.py + dy*scY), 60, CH-60),
      });
    } else if (g.mode === 'pinch') {
      const pts  = [...ptrsRef.current.values()];
      if (pts.length < 2) return;
      const dist = Math.hypot(pts[0].x-pts[1].x, pts[0].y-pts[1].y);
      updateBox(stateRef.current.activeId, {
        fontSize: clamp(Math.round(g.startFS * dist/g.startDist), 28, 220),
      });
    }
  }

  function onPtrUp(e) {
    const g = gestureRef.current;
    // If didn't move — it's a tap → open keyboard
    if (g?.mode === 'drag' && !g.moved) {
      setTyping(true);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
    ptrsRef.current.delete(e.pointerId);
    if (ptrsRef.current.size === 0) gestureRef.current = null;
  }

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div style={S.root}>
      {videoSrc && <video ref={videoRef} src={videoSrc} style={{display:'none'}} loop playsInline muted autoPlay />}

      {/* Hidden textarea for input — always mounted so keyboard works */}
      <textarea
        ref={inputRef}
        value={inputValue}
        onChange={handleInputChange}
        style={S.hiddenInput}
        enterKeyHint="done"
        onBlur={() => setTyping(false)}
        onFocus={() => setTyping(true)}
      />

      {/* ── TOP BAR ── */}
      <div style={{ ...S.topBar, top: typing ? `env(safe-area-inset-top, 0px)` : 0 }}>
        <button onClick={onClose} style={S.topBtn}>Done</button>
        <div style={S.topCenter}>
          {typing && (
            <button onMouseDown={e => { e.preventDefault(); handleSplit(); }} style={S.splitBtn}>
              ↵ Split
            </button>
          )}
        </div>
        <button onClick={addBox} style={S.topBtnAccent}>+ Text</button>
      </div>

      {/* ── CANVAS ── */}
      <div ref={wrapRef} style={{
        ...S.canvasWrap,
        bottom: typing ? kbHeight + 100 : 80,
      }}>
        <canvas
          ref={canvasRef} width={CW} height={CH}
          onPointerDown={onPtrDown} onPointerMove={onPtrMove}
          onPointerUp={onPtrUp}     onPointerCancel={onPtrUp}
          style={S.canvas}
        />
      </div>

      {/* ── BOTTOM TOOLBAR (InShot style) — hidden when keyboard is up ── */}
      {!typing && (
        <div style={S.bottomBar}>

          {/* Tab switcher */}
          <div style={S.tabRow}>
            {[
              { id:'color', icon:'🎨', label:'Color' },
              { id:'font',  icon:'Aa', label:'Font'  },
              { id:'bg',    icon:'▣',  label:'BG'    },
              { id:'align', icon:'≡',  label:'Align' },
            ].map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                style={{ ...S.tabBtn, ...(activeTab===t.id ? S.tabBtnOn : {}) }}>
                <span style={S.tabIcon}>{t.icon}</span>
                <span style={S.tabLabel}>{t.label}</span>
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div style={S.toolRow}>

            {/* COLOR tab — only Black & White */}
            {activeTab === 'color' && (
              <div style={S.toolScroll}>
                {[
                  { c:'#FFFFFF', label:'White' },
                  { c:'#000000', label:'Black' },
                ].map(({ c, label }) => (
                  <button key={c} onClick={() => updateBox(ab?.id, { textColor:c })}
                    style={{
                      ...S.colorItem,
                      background: c,
                      border: ab?.textColor===c ? '4px solid #6366f1' : '3px solid rgba(255,255,255,0.15)',
                      boxShadow: ab?.textColor===c ? '0 0 0 2px #6366f1' : 'none',
                    }}>
                    <span style={{ color: c==='#FFFFFF'?'#000':'#fff', fontSize:10, fontWeight:700 }}>{label}</span>
                  </button>
                ))}
              </div>
            )}

            {/* FONT tab */}
            {activeTab === 'font' && (
              <div style={S.toolScroll}>
                {FONTS.map(f => (
                  <button key={f.value} onClick={() => updateBox(ab?.id, { font:f.value })}
                    style={{
                      ...S.fontItem,
                      fontFamily: f.value,
                      background: ab?.font===f.value ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.07)',
                      border:     ab?.font===f.value ? '2px solid #818cf8' : '2px solid transparent',
                      color:      ab?.font===f.value ? '#fff' : '#aaa',
                    }}>
                    {f.label}
                  </button>
                ))}
              </div>
            )}

            {/* BG tab */}
            {activeTab === 'bg' && (
              <div style={S.toolScroll}>
                {[
                  { v:'none',  label:'None',  bg:'transparent', border:'rgba(255,255,255,0.2)', fg:'#888' },
                  { v:'black', label:'Black', bg:'#000000',      border:'#333',                 fg:'#fff' },
                  { v:'white', label:'White', bg:'#FFFFFF',      border:'#eee',                 fg:'#000' },
                ].map(o => (
                  <button key={o.v} onClick={() => updateBox(ab?.id, { bg:o.v })}
                    style={{
                      ...S.bgItem,
                      background:   o.bg,
                      color:        o.fg,
                      border:       ab?.bg===o.v ? '3px solid #6366f1' : `2px solid ${o.border}`,
                      boxShadow:    ab?.bg===o.v ? '0 0 0 2px #6366f1' : 'none',
                    }}>
                    {o.label}
                  </button>
                ))}
              </div>
            )}

            {/* ALIGN tab */}
            {activeTab === 'align' && (
              <div style={S.toolScroll}>
                {[
                  { v:'left',   label:'Left',   icon:'▤' },
                  { v:'center', label:'Center',  icon:'▥' },
                  { v:'right',  label:'Right',   icon:'▦' },
                ].map(o => (
                  <button key={o.v} onClick={() => updateBox(ab?.id, { align:o.v })}
                    style={{
                      ...S.alignItem,
                      background: ab?.align===o.v ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.07)',
                      border:     ab?.align===o.v ? '2px solid #818cf8' : '2px solid transparent',
                      color:      ab?.align===o.v ? '#fff' : '#888',
                    }}>
                    <span style={{ fontSize:22 }}>{o.icon}</span>
                    <span style={{ fontSize:11 }}>{o.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Delete button */}
          <button onClick={removeActive} style={S.deleteBtn}>Delete Text</button>
        </div>
      )}

      {/* Tap-to-type hint */}
      {!typing && (
        <div style={S.tapHint}>Tap text to edit • Drag to move • Pinch to resize</div>
      )}
    </div>
  );
}

const S = {
  root:        { position:'fixed', inset:0, zIndex:9999, background:'#000', display:'flex', flexDirection:'column', fontFamily:'-apple-system,BlinkMacSystemFont,Arial,sans-serif', overflow:'hidden' },

  hiddenInput: { position:'absolute', opacity:0, width:1, height:1, top:-100, left:-100, fontSize:16, resize:'none', border:'none', outline:'none', background:'transparent', color:'transparent' },

  topBar:      { position:'absolute', left:0, right:0, zIndex:100, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', paddingTop:'calc(14px + env(safe-area-inset-top,0px))', background:'linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)', transition:'top 0.2s' },
  topBtn:      { background:'rgba(255,255,255,0.12)', backdropFilter:'blur(10px)', border:'none', color:'#fff', fontSize:15, fontWeight:700, cursor:'pointer', borderRadius:20, padding:'8px 18px' },
  topBtnAccent:{ background:'rgba(99,102,241,0.35)', backdropFilter:'blur(10px)', border:'1.5px solid rgba(99,102,241,0.7)', color:'#c7d2fe', fontSize:15, fontWeight:700, cursor:'pointer', borderRadius:20, padding:'8px 18px' },
  topCenter:   { flex:1, display:'flex', justifyContent:'center' },
  splitBtn:    { background:'rgba(255,255,255,0.15)', backdropFilter:'blur(10px)', border:'1.5px solid rgba(255,255,255,0.3)', color:'#fff', fontSize:15, fontWeight:700, cursor:'pointer', borderRadius:20, padding:'8px 22px', letterSpacing:'-0.2px' },

  canvasWrap:  { position:'absolute', top:0, left:0, right:0, display:'flex', alignItems:'center', justifyContent:'center', background:'#000', transition:'bottom 0.2s' },
  canvas:      { display:'block', width:'auto', height:'100%', maxWidth:'100%', maxHeight:'100%', touchAction:'none' },

  tapHint:     { position:'absolute', bottom:92, left:0, right:0, textAlign:'center', color:'rgba(255,255,255,0.35)', fontSize:12, fontWeight:500, pointerEvents:'none', letterSpacing:'0.01em' },

  bottomBar:   { position:'absolute', bottom:0, left:0, right:0, background:'rgba(8,8,16,0.96)', backdropFilter:'blur(30px)', borderTop:'1px solid rgba(255,255,255,0.07)', paddingBottom:'env(safe-area-inset-bottom,0px)' },

  tabRow:      { display:'flex', borderBottom:'1px solid rgba(255,255,255,0.06)' },
  tabBtn:      { flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:2, padding:'10px 0 8px', background:'transparent', border:'none', cursor:'pointer', transition:'background 0.15s' },
  tabBtnOn:    { background:'rgba(99,102,241,0.12)', borderBottom:'2px solid #6366f1' },
  tabIcon:     { fontSize:18, lineHeight:1 },
  tabLabel:    { fontSize:10, fontWeight:600, color:'#666', letterSpacing:'0.04em', textTransform:'uppercase' },

  toolRow:     { minHeight:90, padding:'12px 16px' },
  toolScroll:  { display:'flex', gap:12, overflowX:'auto', paddingBottom:4, alignItems:'center' },

  colorItem:   { width:56, height:56, borderRadius:16, cursor:'pointer', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', transition:'border 0.15s, box-shadow 0.15s' },
  fontItem:    { padding:'10px 18px', borderRadius:12, cursor:'pointer', fontSize:15, fontWeight:600, flexShrink:0, whiteSpace:'nowrap', transition:'all 0.15s' },
  bgItem:      { width:72, height:56, borderRadius:14, cursor:'pointer', fontSize:14, fontWeight:700, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', transition:'all 0.15s' },
  alignItem:   { width:72, height:60, borderRadius:14, cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:4, flexShrink:0, transition:'all 0.15s' },

  deleteBtn:   { width:'calc(100% - 32px)', margin:'0 16px 12px', padding:'12px', borderRadius:12, border:'none', background:'rgba(239,68,68,0.1)', color:'#f87171', fontSize:14, fontWeight:700, cursor:'pointer', letterSpacing:'-0.2px' },
};
