import React, { useState, useEffect, useRef, useCallback } from 'react';

const CW = 1080;
const CH = 1920;

const FONTS = [
  { label: 'Anek Bangla',  value: "'Anek Bangla', sans-serif",          weight: '300',  style: 'normal' },
  { label: 'Albert Sans',  value: "'Albert Sans', sans-serif",           weight: '700',  style: 'normal' },
  { label: 'Almoneda',     value: "'Playfair Display', serif",           weight: '700',  style: 'italic' },
  { label: 'Classic',      value: "'Oswald', sans-serif",                weight: '700',  style: 'normal' },
  { label: 'Classic Med',  value: "'Oswald', sans-serif",                weight: '400',  style: 'normal' },
  { label: 'Classic Light',value: "'Oswald', sans-serif",                weight: '300',  style: 'normal' },
  { label: 'Modern',       value: "'Bebas Neue', sans-serif",            weight: '400',  style: 'normal' },
  { label: 'Marker',       value: "'Permanent Marker', cursive",         weight: '400',  style: 'normal' },
  { label: 'Pacifico',     value: "'Pacifico', cursive",                 weight: '400',  style: 'normal' },
  { label: 'Script',       value: "'Dancing Script', cursive",           weight: '700',  style: 'normal' },
  { label: 'Exo Light',    value: "'Exo 2', sans-serif",                 weight: '200',  style: 'normal' },
  { label: 'Rajdhani',     value: "'Rajdhani', sans-serif",              weight: '700',  style: 'normal' },
];

const COLORS = ['#FFFFFF','#000000','#FFEE00','#FF3B30','#FF9500','#34C759','#007AFF','#FF2D55','#AF52DE','#FF6B35'];

const BGS = [
  { v: 'none',   bg: 'transparent', fg: '#fff' },
  { v: 'black',  bg: '#000000',     fg: '#fff' },
  { v: 'white',  bg: '#FFFFFF',     fg: '#000' },
  { v: 'yellow', bg: '#FFEE00',     fg: '#000' },
];

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Inject Google Fonts once
let fontsInjected = false;
function injectFonts() {
  if (fontsInjected) return;
  fontsInjected = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://fonts.googleapis.com/css2?family=Anek+Bangla:wght@300;400&family=Albert+Sans:wght@700&family=Playfair+Display:ital,wght@1,700&family=Bebas+Neue&family=Oswald:wght@300;400;700&family=Rajdhani:wght@700&family=Exo+2:wght@200;700&family=Permanent+Marker&family=Pacifico&family=Dancing+Script:wght@700&display=swap';
  document.head.appendChild(link);
}

export default function TextOverlayEditor({ videoSrc, textBoxes, onChange, onClose }) {
  injectFonts();

  const makeBox = (raw) => ({
    id:        raw?.id        ?? Date.now(),
    text:      raw?.text      ?? '',
    fontSize:  raw?.fontSize  ?? 80,
    posX:      raw?.posX      ?? (raw?.xPct != null ? Math.round((raw.xPct/100)*CW) : CW/2),
    posY:      raw?.posY      ?? (raw?.yPct != null ? Math.round((raw.yPct/100)*CH) : CH*0.25),
    fontIdx:   0,
    textColor: raw?.textColor ?? '#FFFFFF',
    bg:        raw?.bg        ?? 'none',
    align:     raw?.align     ?? 'left',
  });

  const [boxes,    setBoxes]    = useState(() => textBoxes?.length ? textBoxes.map(makeBox) : [makeBox(null)]);
  const [activeId, setActiveId] = useState(() => textBoxes?.[0]?.id ?? boxes[0]?.id);

  const canvasRef  = useRef(null);
  const videoRef   = useRef(null);
  const wrapRef    = useRef(null);
  const gestureRef = useRef(null);
  const ptrsRef    = useRef(new Map());
  const stateRef   = useRef({ boxes, activeId });
  const sliderDrag = useRef(false);
  const sliderStart= useRef(null);
  const [dispRect, setDispRect] = useState({ x:0, y:0, w:1, h:1 });

  useEffect(() => { stateRef.current = { boxes, activeId }; }, [boxes, activeId]);

  useEffect(() => {
    function measure() {
      const r = wrapRef.current?.getBoundingClientRect();
      if (r) setDispRect({ x:r.left, y:r.top, w:r.width, h:r.height });
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Emit to parent
  useEffect(() => {
    const out = boxes.map(b => {
      const f = FONTS[b.fontIdx] ?? FONTS[0];
      return {
        id: b.id, text: b.text,
        lines: b.text.split('\n'),
        fontSize: b.fontSize,
        fontSizePct: b.fontSize / CW,
        posX: b.posX, posY: b.posY,
        font: f.value.replace(/'/g, '').split(',')[0].trim(),
        fontFamily: f.value,
        fontWeight: f.weight,
        textColor: b.textColor, colorHex: b.textColor,
        xPct: (b.posX/CW)*100, yPct: (b.posY/CH)*100,
        bg: b.bg, align: b.align, widthPct: 80,
      };
    });
    onChange(out.filter(b => b.text.trim() && b.text !== 'Tap to type'));
  }, [boxes]); // eslint-disable-line

  const updateBox = useCallback((id, patch) => {
    setBoxes(prev => prev.map(b => b.id === id ? { ...b, ...patch } : b));
  }, []);

  const ab    = boxes.find(b => b.id === activeId) ?? boxes[0];
  const font  = FONTS[ab?.fontIdx ?? 0];
  const bgObj = BGS.find(b => b.v === (ab?.bg ?? 'none')) ?? BGS[0];
  const hasBg = ab?.bg !== 'none';
  const textCol = (ab?.bg === 'white' || ab?.bg === 'yellow') ? '#000' : (ab?.textColor ?? '#fff');

  // ── WRAP TEXT FOR CANVAS ─────────────────────────────────────────────────
  function getWrappedLines(ctx, text, fontSize, fontValue, maxW) {
    ctx.font = `${fontSize}px ${fontValue}`;
    const lines = [];
    text.split('\n').forEach(para => {
      if (!para) { lines.push(''); return; }
      const words = para.split(' ');
      let cur = '';
      words.forEach(w => {
        const test = cur ? cur + ' ' + w : w;
        if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; }
        else cur = test;
      });
      if (cur) lines.push(cur);
    });
    return lines;
  }

  // ── CANVAS DRAW ──────────────────────────────────────────────────────────
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
      if (!b.text.trim()) return;
      const isActive = b.id === activeId;
      const f = FONTS[b.fontIdx ?? 0];
      const maxW = CW * 0.82;
      const lines = getWrappedLines(ctx, b.text, b.fontSize, f.value, maxW);
      const lineH = b.fontSize * 1.3;
      const totalH = lines.length * lineH;
      const startY = b.posY - totalH/2 + lineH/2;

      ctx.font = `${f.weight} ${b.fontSize}px ${f.value}`;
      ctx.textBaseline = 'middle';

      const anchorX = b.align === 'center' ? b.posX :
                      b.align === 'right'  ? b.posX + maxW/2 :
                                             b.posX - maxW/2;
      ctx.textAlign = b.align || 'left';

      const bgColor = b.bg === 'black'  ? '#000' :
                      b.bg === 'white'  ? '#fff' :
                      b.bg === 'yellow' ? '#FFEE00' : null;
      const fgColor = (b.bg === 'white' || b.bg === 'yellow') ? '#000' : b.textColor;

      if (bgColor) {
        // Draw ONE background rect for ALL lines — no gaps
        const maxTw = Math.max(...lines.map(l => ctx.measureText(l).width));
        const pad = 20;
        const bgX = b.align === 'left'   ? anchorX - pad :
                    b.align === 'right'  ? anchorX - maxTw - pad :
                                           anchorX - maxTw/2 - pad;
        ctx.fillStyle = bgColor;
        ctx.beginPath();
        ctx.roundRect(bgX, b.posY - totalH/2 - 12, maxTw + pad*2, totalH + 24, 8);
        ctx.fill();
      }

      lines.forEach((line, i) => {
        const ly = startY + i * lineH;
        ctx.fillStyle = fgColor;
        ctx.fillText(line, anchorX, ly);
      });

      if (isActive) {
        const maxTw = Math.max(...lines.map(l => ctx.measureText(l).width));
        const pad = 36;
        const bx = b.align === 'left'  ? anchorX - pad :
                   b.align === 'right' ? anchorX - maxTw - pad :
                                          anchorX - maxTw/2 - pad;
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 4;
        ctx.setLineDash([10, 6]);
        ctx.strokeRect(bx, b.posY - totalH/2 - pad/2, maxTw + pad*2, totalH + pad);
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

  // ── SLIDER (resize) ──────────────────────────────────────────────────────
  function startSlider(e) {
    e.preventDefault();
    sliderDrag.current = true;
    sliderStart.current = { y: e.touches?.[0]?.clientY ?? e.clientY, startFS: ab?.fontSize ?? 80 };
  }

  useEffect(() => {
    function onMove(e) {
      if (!sliderDrag.current || !sliderStart.current) return;
      const curY = e.touches?.[0]?.clientY ?? e.clientY;
      const dy = sliderStart.current.y - curY;
      updateBox(stateRef.current.activeId, {
        fontSize: clamp(Math.round(sliderStart.current.startFS + dy * 0.9), 24, 200),
      });
    }
    function onEnd() { sliderDrag.current = false; }
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onEnd);
    return () => {
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onEnd);
    };
  }, [updateBox]);

  // ── DRAG TEXT ────────────────────────────────────────────────────────────
  function hitTest(box, cx, cy) {
    if (!box || !canvasRef.current) return false;
    const ctx = canvasRef.current.getContext('2d');
    const f = FONTS[box.fontIdx ?? 0];
    ctx.font = `${f.weight} ${box.fontSize}px ${f.value}`;
    const lines = box.text.split('\n');
    const maxTw = Math.max(...lines.map(l => ctx.measureText(l).width), 80);
    const totalH = lines.length * box.fontSize * 1.3;
    const pad = 80;
    return cx >= box.posX - maxTw/2 - pad && cx <= box.posX + maxTw/2 + pad &&
           cy >= box.posY - totalH/2 - pad && cy <= box.posY + totalH/2 + pad;
  }

  function s2c(sx, sy) {
    return { cx:(sx-dispRect.x)*(CW/dispRect.w), cy:(sy-dispRect.y)*(CH/dispRect.h) };
  }

  function onPtrDown(e) {
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch(_) {}
    ptrsRef.current.set(e.pointerId, { x:e.clientX, y:e.clientY });

    if (ptrsRef.current.size >= 2) {
      const pts = [...ptrsRef.current.values()];
      const dist = Math.hypot(pts[0].x-pts[1].x, pts[0].y-pts[1].y);
      const box = stateRef.current.boxes.find(b => b.id===stateRef.current.activeId);
      gestureRef.current = { mode:'pinch', startDist:dist, startFS: box?.fontSize ?? 80 };
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
    gestureRef.current = null;
  }

  function onPtrMove(e) {
    const ptr = ptrsRef.current.get(e.pointerId);
    if (ptr) { ptr.x=e.clientX; ptr.y=e.clientY; }
    const g = gestureRef.current;
    if (!g) return;
    if (g.mode === 'drag') {
      const dx = e.clientX-g.sx, dy = e.clientY-g.sy;
      if (Math.abs(dx)>3||Math.abs(dy)>3) g.moved=true;
      if (!g.moved) return;
      updateBox(g.id, {
        posX: clamp(Math.round(g.px+dx*(CW/dispRect.w)), 60, CW-60),
        posY: clamp(Math.round(g.py+dy*(CH/dispRect.h)), 60, CH-60),
      });
    } else if (g.mode === 'pinch') {
      const pts = [...ptrsRef.current.values()];
      if (pts.length<2) return;
      const dist = Math.hypot(pts[0].x-pts[1].x, pts[0].y-pts[1].y);
      updateBox(stateRef.current.activeId, {
        fontSize: clamp(Math.round(g.startFS*dist/g.startDist), 24, 200),
      });
    }
  }

  function onPtrUp(e) {
    ptrsRef.current.delete(e.pointerId);
    if (ptrsRef.current.size===0) gestureRef.current=null;
  }

  const sliderPct = 1 - ((ab?.fontSize ?? 80) - 24) / (200 - 24);
  const alignCycle = () => updateBox(ab?.id, { align: { left:'center', center:'right', right:'left' }[ab?.align??'left'] });
  const bgCycle    = () => updateBox(ab?.id, { bg: BGS[(BGS.findIndex(b=>b.v===(ab?.bg??'none'))+1)%BGS.length].v });

  return (
    <div style={S.root}>
      {videoSrc && <video ref={videoRef} src={videoSrc} style={{display:'none'}} loop playsInline muted autoPlay />}

      {/* TOP BAR */}
      <div style={S.topBar}>
        <button onClick={onClose} style={S.topLeft}>Done</button>
        <div style={S.topMid}>
          <button onClick={alignCycle} style={S.topBtn}><AlignIcon align={ab?.align??'left'}/></button>
          <button onClick={bgCycle} style={{
            ...S.topBtn,
            background: hasBg ? bgObj.bg : 'rgba(255,255,255,0.12)',
            border: '1.5px solid rgba(255,255,255,0.35)',
            color: bgObj.fg, fontSize: 10, fontWeight: 800,
          }}>BG</button>
        </div>
        <button onClick={onClose} style={S.topRight}>Save</button>
      </div>

      {/* MAIN ROW: slider + canvas */}
      <div style={S.mainRow}>
        {/* LEFT SLIDER */}
        <div style={S.sliderCol} onMouseDown={startSlider} onTouchStart={startSlider}>
          <span style={S.sliderA}>A</span>
          <div style={S.sliderTrack}>
            <div style={{ ...S.sliderThumb, top:`${sliderPct*80+4}%` }} />
          </div>
          <span style={S.sliderA2}>A</span>
        </div>

        {/* VIDEO CANVAS */}
        <div ref={wrapRef} style={S.canvasWrap}>
          <canvas
            ref={canvasRef} width={CW} height={CH}
            onPointerDown={onPtrDown} onPointerMove={onPtrMove}
            onPointerUp={onPtrUp} onPointerCancel={onPtrUp}
            style={S.canvas}
          />
        </div>
      </div>

      {/* DIVIDER */}
      <div style={S.div} />

      {/* COLOR ROW */}
      <div style={S.colorRow}>
        {COLORS.map(c => (
          <button key={c} onClick={() => updateBox(ab?.id, { textColor: c })} style={{
            ...S.dot,
            background: c,
            border: ab?.textColor===c ? '3px solid #fff' : c==='#FFFFFF' ? '1.5px solid #555' : '2px solid transparent',
            transform: ab?.textColor===c ? 'scale(1.3)' : 'scale(1)',
            boxShadow: ab?.textColor===c ? `0 0 0 1.5px ${c}` : 'none',
          }}/>
        ))}
      </div>

      {/* TEXT INPUT + ALIGN */}
      <div style={S.inputRow}>
        <textarea
          value={ab?.text ?? ''}
          onChange={e => updateBox(ab?.id, { text: e.target.value })}
          rows={3}
          style={{
            ...S.ta,
            fontFamily: font?.value,
            fontWeight: font?.weight,
            fontStyle: font?.style,
            textAlign: ab?.align ?? 'left',
          }}
          placeholder="Type your text..."
          autoFocus
        />
        <button onClick={alignCycle} style={S.alignBtn}>
          <AlignIcon align={ab?.align??'left'}/>
        </button>
      </div>

      {/* FONT STRIP */}
      <div style={S.fontRow}>
        {FONTS.map((f, i) => (
          <button key={f.label} onClick={() => updateBox(ab?.id, { fontIdx: i })} style={{
            ...S.fontPill,
            fontFamily: f.value,
            fontWeight: f.weight,
            fontStyle: f.style,
            background: (ab?.fontIdx??0)===i ? '#2C2C2E' : 'transparent',
            color: (ab?.fontIdx??0)===i ? '#fff' : '#777',
            borderBottom: (ab?.fontIdx??0)===i ? '2.5px solid #fff' : '2.5px solid transparent',
          }}>
            {f.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function AlignIcon({ align }) {
  return align === 'left' ? (
    <svg width="16" height="13" viewBox="0 0 24 18" fill="none">
      <path d="M2 3h20M2 9h13M2 15h16" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/>
    </svg>
  ) : align === 'center' ? (
    <svg width="16" height="13" viewBox="0 0 24 18" fill="none">
      <path d="M2 3h20M5 9h14M3 15h18" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/>
    </svg>
  ) : (
    <svg width="16" height="13" viewBox="0 0 24 18" fill="none">
      <path d="M2 3h20M9 9h13M6 15h16" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/>
    </svg>
  );
}

const S = {
  root:      { position:'fixed', inset:0, zIndex:9999, background:'#1C1C1E', display:'flex', flexDirection:'column', fontFamily:'-apple-system,BlinkMacSystemFont,sans-serif', overflow:'hidden' },
  topBar:    { flexShrink:0, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 14px 8px', paddingTop:'calc(12px + env(safe-area-inset-top,0px))', borderBottom:'1px solid #2C2C2E' },
  topLeft:   { background:'transparent', border:'none', color:'#888', fontSize:15, fontWeight:600, cursor:'pointer', padding:0 },
  topRight:  { background:'transparent', border:'none', color:'#fff', fontSize:15, fontWeight:700, cursor:'pointer', padding:0 },
  topMid:    { display:'flex', gap:10, alignItems:'center' },
  topBtn:    { width:36, height:36, borderRadius:18, background:'rgba(255,255,255,0.1)', border:'none', color:'#fff', fontSize:14, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' },
  mainRow:   { display:'flex', flex:1, minHeight:0, overflow:'hidden' },
  sliderCol: { width:40, flexShrink:0, display:'flex', flexDirection:'column', alignItems:'center', padding:'10px 0', cursor:'ns-resize', userSelect:'none', touchAction:'none', background:'#1C1C1E' },
  sliderA:   { fontSize:18, fontWeight:800, color:'rgba(255,255,255,0.4)', lineHeight:1 },
  sliderA2:  { fontSize:9,  fontWeight:700, color:'rgba(255,255,255,0.4)', lineHeight:1 },
  sliderTrack:{ flex:1, width:4, background:'rgba(255,255,255,0.15)', borderRadius:4, margin:'6px 0', position:'relative' },
  sliderThumb:{ position:'absolute', width:22, height:22, background:'#fff', borderRadius:'50%', left:'50%', transform:'translate(-50%,-50%)', boxShadow:'0 2px 10px rgba(0,0,0,0.6)' },
  canvasWrap:{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden', background:'#000' },
  canvas:    { display:'block', width:'auto', height:'100%', maxWidth:'100%', maxHeight:'100%', touchAction:'none' },
  div:       { height:1, background:'#2C2C2E', flexShrink:0 },
  colorRow:  { flexShrink:0, display:'flex', gap:10, alignItems:'center', padding:'10px 14px 8px', overflowX:'auto', background:'#1C1C1E' },
  dot:       { width:28, height:28, borderRadius:'50%', flexShrink:0, cursor:'pointer', padding:0, transition:'transform 0.15s,box-shadow 0.15s' },
  inputRow:  { flexShrink:0, display:'flex', alignItems:'flex-start', gap:8, padding:'6px 12px 4px', borderTop:'1px solid #2C2C2E', background:'#1C1C1E' },
  ta:        { flex:1, background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:10, padding:'9px 11px', fontSize:15, outline:'none', resize:'none', lineHeight:1.4, color:'#fff' },
  alignBtn:  { width:34, height:34, marginTop:4, flexShrink:0, background:'rgba(255,255,255,0.08)', border:'none', color:'#fff', borderRadius:8, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' },
  fontRow:   { flexShrink:0, display:'flex', overflowX:'auto', padding:'4px 6px 0', borderTop:'1px solid #2C2C2E', background:'#1C1C1E', paddingBottom:'env(safe-area-inset-bottom,8px)' },
  fontPill:  { flexShrink:0, padding:'8px 12px', fontSize:15, cursor:'pointer', border:'none', borderRadius:0, transition:'all 0.15s', whiteSpace:'nowrap', lineHeight:1.2, background:'transparent' },
};
