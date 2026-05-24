import React, { useState, useEffect, useRef, useCallback } from 'react';

const CW = 1080;
const CH = 1920;

const FONTS = [
  { label: 'Anek Bangla',   value: "'Anek Bangla', sans-serif",        weight: '300', style: 'normal' },
  { label: 'Albert Sans',   value: "'Albert Sans', sans-serif",         weight: '700', style: 'normal' },
  { label: 'Almoneda',      value: "'Playfair Display', serif",         weight: '700', style: 'italic' },
  { label: 'Classic',       value: "'Oswald', sans-serif",              weight: '700', style: 'normal' },
  { label: 'Classic Med',   value: "'Oswald', sans-serif",              weight: '400', style: 'normal' },
  { label: 'Classic Light', value: "'Oswald', sans-serif",              weight: '300', style: 'normal' },
  { label: 'Modern',        value: "'Bebas Neue', sans-serif",          weight: '400', style: 'normal' },
  { label: 'Marker',        value: "'Permanent Marker', cursive",       weight: '400', style: 'normal' },
  { label: 'Pacifico',      value: "'Pacifico', cursive",               weight: '400', style: 'normal' },
  { label: 'Script',        value: "'Dancing Script', cursive",         weight: '700', style: 'normal' },
  { label: 'Exo Light',     value: "'Exo 2', sans-serif",              weight: '200', style: 'normal' },
  { label: 'Rajdhani',      value: "'Rajdhani', sans-serif",            weight: '700', style: 'normal' },
];

const COLORS = ['#FFFFFF','#000000','#FFEE00','#FF3B30','#FF9500','#34C759','#007AFF','#FF2D55','#AF52DE','#FF6B35'];
const BGS = [
  { v:'none',   bg:'transparent', fg:'#fff' },
  { v:'black',  bg:'#000000',     fg:'#fff' },
  { v:'white',  bg:'#FFFFFF',     fg:'#000' },
  { v:'yellow', bg:'#FFEE00',     fg:'#000' },
];

function clamp(v,lo,hi){ return Math.max(lo,Math.min(hi,v)); }
function uid(){ return Math.random().toString(36).slice(2,9); }

let fontsInjected = false;
function injectFonts(){
  if(fontsInjected) return; fontsInjected = true;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = 'https://fonts.googleapis.com/css2?family=Anek+Bangla:wght@300;400&family=Albert+Sans:wght@700&family=Playfair+Display:ital,wght@1,700&family=Bebas+Neue&family=Oswald:wght@300;400;700&family=Rajdhani:wght@700&family=Exo+2:wght@200&family=Permanent+Marker&family=Pacifico&family=Dancing+Script:wght@700&display=swap';
  document.head.appendChild(l);
}

export default function TextOverlayEditor({ videoSrc, textBoxes, onChange, onClose }){
  injectFonts();

  const makeBox = (raw) => ({
    id:        raw?.id        ?? uid(),
    text:      raw?.text      ?? '',
    fontSize:  raw?.fontSize  ?? 80,
    xPct:      raw?.xPct      ?? 50,
    yPct:      raw?.yPct      ?? 25,
    fontIdx:   raw?.fontIdx   ?? 0,
    textColor: raw?.textColor ?? '#FFFFFF',
    bg:        raw?.bg        ?? 'none',
    align:     raw?.align     ?? 'left',
  });

  const [boxes,    setBoxes]    = useState(() => textBoxes?.length ? textBoxes.map(makeBox) : [makeBox(null)]);
  const [activeId, setActiveId] = useState(() => textBoxes?.[0]?.id ?? boxes[0]?.id);

  const canvasRef  = useRef(null);
  const videoRef   = useRef(null);
  const gestureRef = useRef(null);
  const ptrsRef    = useRef(new Map());
  const stateRef   = useRef({ boxes, activeId });
  const sliderDrag = useRef(false);
  const sliderStart= useRef(null);

  useEffect(()=>{ stateRef.current = { boxes, activeId }; },[boxes,activeId]);

  // Emit to parent
  useEffect(()=>{
    const out = boxes.map(b => {
      const font = FONTS[b.fontIdx??0];
      return {
        id: b.id, text: b.text,
        lines: b.text.split('\n'),
        fontSize: b.fontSize,
        fontSizePct: b.fontSize / CW,
        posX: Math.round((b.xPct/100)*CW),
        posY: Math.round((b.yPct/100)*CH),
        xPct: b.xPct, yPct: b.yPct,
        font: font.value.replace(/'/g,'').split(',')[0].trim(),
        fontFamily: font.value,
        fontWeight: font.weight,
        textColor: b.textColor, colorHex: b.textColor,
        bg: b.bg, align: b.align, widthPct: 80,
      };
    });
    onChange(out.filter(b => b.text.trim()));
  },[boxes]); // eslint-disable-line

  const updateBox = useCallback((id,patch)=>{
    setBoxes(prev=>prev.map(b=>b.id===id?{...b,...patch}:b));
  },[]);

  const addBox = ()=>{
    const nb = makeBox({ id:uid(), xPct:50, yPct:50 });
    setBoxes(prev=>[...prev, nb]);
    setActiveId(nb.id);
  };

  const removeBox = (id)=>{
    setBoxes(prev=>{ const n=prev.filter(b=>b.id!==id); return n.length?n:[makeBox(null)]; });
    setActiveId(boxes.find(b=>b.id!==id)?.id ?? boxes[0]?.id);
  };

  const ab    = boxes.find(b=>b.id===activeId) ?? boxes[0];
  const font  = FONTS[ab?.fontIdx??0];
  const bgObj = BGS.find(b=>b.v===(ab?.bg??'none'))??BGS[0];
  const hasBg = ab?.bg !== 'none';

  // ── CANVAS DRAW ──────────────────────────────────────────────
  const draw = useCallback(()=>{
    const canvas = canvasRef.current;
    if(!canvas) return;
    const ctx = canvas.getContext('2d');
    const { boxes, activeId } = stateRef.current;

    ctx.fillStyle = '#000';
    ctx.fillRect(0,0,CW,CH);

    const vid = videoRef.current;
    if(vid && vid.readyState>=2){
      try{
        const vw=vid.videoWidth||CW, vh=vid.videoHeight||CH;
        const vR=vw/vh, cR=CW/CH;
        let dw,dh,dx=0,dy=0;
        if(vR>cR){ dw=CW; dh=CW/vR; dy=(CH-dh)/2; }
        else     { dh=CH; dw=CH*vR; dx=(CW-dw)/2; }
        ctx.drawImage(vid,dx,dy,dw,dh);
      }catch(_){}
    }

    boxes.forEach(b=>{
      if(!b.text.trim()) return;
      const isActive = b.id===activeId;
      const f = FONTS[b.fontIdx??0];
      const posX = Math.round((b.xPct/100)*CW);
      const posY = Math.round((b.yPct/100)*CH);
      const maxW = CW*0.85;

      ctx.font = `${f.weight} ${b.fontSize}px ${f.value}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = b.align||'left';

      // Wrap text
      const lines = [];
      b.text.split('\n').forEach(para=>{
        if(!para){ lines.push(''); return; }
        const words = para.split(' ');
        let cur='';
        words.forEach(w=>{
          const test = cur?cur+' '+w:w;
          if(ctx.measureText(test).width>maxW&&cur){ lines.push(cur); cur=w; }
          else cur=test;
        });
        if(cur) lines.push(cur);
      });

      const lineH  = b.fontSize*1.3;
      const totalH = lines.length*lineH;
      const startY = posY-totalH/2+lineH/2;
      const anchorX = b.align==='center'?posX:b.align==='right'?posX+maxW/2:posX-maxW/2;

      const bgColor = b.bg==='black'?'#000':b.bg==='white'?'#fff':b.bg==='yellow'?'#FFEE00':null;
      const fgColor = (b.bg==='white'||b.bg==='yellow')?'#000':b.textColor;

      if(bgColor){
        const maxTw=Math.max(...lines.map(l=>ctx.measureText(l).width));
        const pad=22;
        const bgX=b.align==='left'?anchorX-pad:b.align==='right'?anchorX-maxTw-pad:anchorX-maxTw/2-pad;
        ctx.fillStyle=bgColor;
        ctx.beginPath();
        ctx.roundRect(bgX,posY-totalH/2-14,maxTw+pad*2,totalH+28,8);
        ctx.fill();
      }

      lines.forEach((line,i)=>{
        ctx.fillStyle=fgColor;
        ctx.fillText(line,anchorX,startY+i*lineH);
      });

      if(isActive){
        ctx.font=`${f.weight} ${b.fontSize}px ${f.value}`;
        const maxTw=Math.max(...lines.map(l=>ctx.measureText(l).width),60);
        const pad=38;
        const bx=b.align==='left'?anchorX-pad:b.align==='right'?anchorX-maxTw-pad:anchorX-maxTw/2-pad;
        ctx.strokeStyle='rgba(255,255,255,0.85)';
        ctx.lineWidth=4; ctx.setLineDash([10,6]);
        ctx.strokeRect(bx,posY-totalH/2-pad/2,maxTw+pad*2,totalH+pad);
        ctx.setLineDash([]);
      }
    });
  },[]);

  useEffect(()=>{
    let raf;
    const loop=()=>{ draw(); raf=requestAnimationFrame(loop); };
    raf=requestAnimationFrame(loop);
    return()=>cancelAnimationFrame(raf);
  },[draw]);

  // ── SLIDER ───────────────────────────────────────────────────
  function startSlider(e){
    e.preventDefault();
    sliderDrag.current=true;
    sliderStart.current={ y:e.touches?.[0]?.clientY??e.clientY, startFS:ab?.fontSize??80 };
  }
  useEffect(()=>{
    function onMove(e){
      if(!sliderDrag.current) return;
      const curY=e.touches?.[0]?.clientY??e.clientY;
      updateBox(stateRef.current.activeId,{
        fontSize:clamp(Math.round(sliderStart.current.startFS+(sliderStart.current.y-curY)*0.9),24,200),
      });
    }
    function onEnd(){ sliderDrag.current=false; }
    window.addEventListener('touchmove',onMove,{passive:false});
    window.addEventListener('touchend',onEnd);
    window.addEventListener('mousemove',onMove);
    window.addEventListener('mouseup',onEnd);
    return()=>{
      window.removeEventListener('touchmove',onMove);
      window.removeEventListener('touchend',onEnd);
      window.removeEventListener('mousemove',onMove);
      window.removeEventListener('mouseup',onEnd);
    };
  },[updateBox]);

  // ── DRAG & PINCH ─────────────────────────────────────────────
  function s2c(sx,sy){
    const c=canvasRef.current; if(!c) return {cx:0,cy:0};
    const r=c.getBoundingClientRect();
    return { cx:(sx-r.left)*(CW/r.width), cy:(sy-r.top)*(CH/r.height) };
  }

  function hitTest(box,cx,cy){
    if(!box) return false;
    const posX=Math.round((box.xPct/100)*CW);
    const posY=Math.round((box.yPct/100)*CH);
    const pad=120;
    return cx>=posX-pad&&cx<=posX+pad&&cy>=posY-pad&&cy<=posY+pad;
  }

  function onPtrDown(e){
    e.preventDefault();
    try{ e.currentTarget.setPointerCapture(e.pointerId); }catch(_){}
    ptrsRef.current.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(ptrsRef.current.size>=2){
      const pts=[...ptrsRef.current.values()];
      const dist=Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y);
      const box=stateRef.current.boxes.find(b=>b.id===stateRef.current.activeId);
      gestureRef.current={mode:'pinch',startDist:dist,startFS:box?.fontSize??80};
      return;
    }
    const {cx,cy}=s2c(e.clientX,e.clientY);
    for(let i=stateRef.current.boxes.length-1;i>=0;i--){
      const box=stateRef.current.boxes[i];
      if(hitTest(box,cx,cy)){
        setActiveId(box.id);
        gestureRef.current={mode:'drag',sx:e.clientX,sy:e.clientY,ox:box.xPct,oy:box.yPct,id:box.id,moved:false};
        return;
      }
    }
    gestureRef.current=null;
  }

  function onPtrMove(e){
    const ptr=ptrsRef.current.get(e.pointerId);
    if(ptr){ptr.x=e.clientX;ptr.y=e.clientY;}
    const g=gestureRef.current; if(!g) return;
    if(g.mode==='drag'){
      const dx=e.clientX-g.sx,dy=e.clientY-g.sy;
      if(Math.abs(dx)>3||Math.abs(dy)>3) g.moved=true;
      if(!g.moved) return;
      const r=canvasRef.current?.getBoundingClientRect();
      if(!r) return;
      updateBox(g.id,{
        xPct:clamp(g.ox+(dx/r.width)*100,2,98),
        yPct:clamp(g.oy+(dy/r.height)*100,2,98),
      });
    } else if(g.mode==='pinch'){
      const pts=[...ptrsRef.current.values()];
      if(pts.length<2) return;
      const dist=Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y);
      updateBox(stateRef.current.activeId,{fontSize:clamp(Math.round(g.startFS*dist/g.startDist),24,200)});
    }
  }

  function onPtrUp(e){
    ptrsRef.current.delete(e.pointerId);
    if(ptrsRef.current.size===0) gestureRef.current=null;
  }

  const sliderPct  = 1-((ab?.fontSize??80)-24)/(200-24);
  const alignCycle = ()=>updateBox(ab?.id,{align:{left:'center',center:'right',right:'left'}[ab?.align??'left']});
  const bgCycle    = ()=>updateBox(ab?.id,{bg:BGS[(BGS.findIndex(b=>b.v===(ab?.bg??'none'))+1)%BGS.length].v});

  return(
    <div style={S.root}>
      {videoSrc && <video ref={videoRef} src={videoSrc} style={{display:'none'}} loop playsInline muted autoPlay/>}

      {/* TOP BAR */}
      <div style={S.topBar}>
        <button onClick={onClose} style={S.btnGhost}>Done</button>
        <div style={S.topMid}>
          <button onClick={alignCycle} style={S.iconBtn}><AlignIcon align={ab?.align??'left'}/></button>
          <button onClick={bgCycle} style={{
            ...S.iconBtn,
            background:hasBg?bgObj.bg:'rgba(255,255,255,0.1)',
            border:'1.5px solid rgba(255,255,255,0.3)',
            color:bgObj.fg,fontSize:10,fontWeight:800,
          }}>BG</button>
          <button onClick={addBox} style={S.addBtn}>+ Text</button>
        </div>
        <button onClick={onClose} style={{...S.btnGhost,color:'#fff',fontWeight:700}}>Save</button>
      </div>

      {/* MIDDLE: slider + video — COMPACT HEIGHT */}
      <div style={S.middle}>
        {/* Slider */}
        <div style={S.slider} onMouseDown={startSlider} onTouchStart={startSlider}>
          <span style={S.sliderBig}>A</span>
          <div style={S.track}>
            <div style={{...S.thumb,top:`${sliderPct*78+4}%`}}/>
          </div>
          <span style={S.sliderSm}>A</span>
        </div>

        {/* Video canvas — 9:16 fixed box, compact */}
        <div style={S.videoWrap}>
          <canvas
            ref={canvasRef} width={CW} height={CH}
            onPointerDown={onPtrDown} onPointerMove={onPtrMove}
            onPointerUp={onPtrUp} onPointerCancel={onPtrUp}
            style={S.canvas}
          />
        </div>
      </div>

      {/* Text tabs — only if multiple */}
      {boxes.length>1 && (
        <div style={S.tabs}>
          {boxes.map((b,i)=>(
            <button key={b.id} onClick={()=>setActiveId(b.id)} style={{
              ...S.tab,
              color:b.id===activeId?'#fff':'#666',
              borderBottom:b.id===activeId?'2px solid #fff':'2px solid transparent',
              background:b.id===activeId?'rgba(255,255,255,0.08)':'transparent',
            }}>T{i+1}</button>
          ))}
          <button onClick={()=>removeBox(activeId)} style={S.removeTab}>✕</button>
        </div>
      )}

      {/* COLORS */}
      <div style={S.colorRow}>
        {COLORS.map(c=>(
          <button key={c} onClick={()=>updateBox(ab?.id,{textColor:c})} style={{
            ...S.dot,
            background:c,
            border:ab?.textColor===c?'3px solid #fff':c==='#FFFFFF'?'1.5px solid #555':'2px solid transparent',
            transform:ab?.textColor===c?'scale(1.25)':'scale(1)',
          }}/>
        ))}
      </div>

      {/* TEXT INPUT */}
      <div style={S.inputRow}>
        <textarea
          value={ab?.text??''}
          onChange={e=>updateBox(ab?.id,{text:e.target.value})}
          rows={2}
          style={{
            ...S.ta,
            fontFamily:font?.value,
            fontWeight:font?.weight,
            fontStyle:font?.style,
            textAlign:ab?.align??'left',
          }}
          placeholder="Type your text..."
          autoFocus
        />
        <button onClick={alignCycle} style={S.alignSide}>
          <AlignIcon align={ab?.align??'left'}/>
        </button>
      </div>

      {/* FONT STRIP */}
      <div style={S.fontRow}>
        {FONTS.map((f,i)=>(
          <button key={f.label} onClick={()=>updateBox(ab?.id,{fontIdx:i})} style={{
            ...S.fontBtn,
            fontFamily:f.value, fontWeight:f.weight, fontStyle:f.style,
            color:(ab?.fontIdx??0)===i?'#fff':'#666',
            borderBottom:(ab?.fontIdx??0)===i?'2px solid #fff':'2px solid transparent',
            background:(ab?.fontIdx??0)===i?'rgba(255,255,255,0.08)':'transparent',
          }}>{f.label}</button>
        ))}
      </div>
    </div>
  );
}

function AlignIcon({align}){
  return align==='left'?(<svg width="15" height="12" viewBox="0 0 24 18" fill="none"><path d="M2 3h20M2 9h13M2 15h16" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/></svg>)
    :align==='center'?(<svg width="15" height="12" viewBox="0 0 24 18" fill="none"><path d="M2 3h20M5 9h14M3 15h18" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/></svg>)
    :(<svg width="15" height="12" viewBox="0 0 24 18" fill="none"><path d="M2 3h20M9 9h13M6 15h16" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/></svg>);
}

const VIDEO_H = 180; // compact video height in px

const S = {
  root:    { position:'fixed', inset:0, zIndex:9999, background:'#1C1C1E', display:'flex', flexDirection:'column', fontFamily:'-apple-system,BlinkMacSystemFont,sans-serif', overflow:'hidden' },

  // Top bar
  topBar:  { flexShrink:0, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 14px', paddingTop:'calc(10px + env(safe-area-inset-top,0px))', borderBottom:'1px solid #2C2C2E' },
  btnGhost:{ background:'transparent', border:'none', color:'#888', fontSize:15, fontWeight:600, cursor:'pointer', padding:'4px 0' },
  topMid:  { display:'flex', gap:8, alignItems:'center' },
  iconBtn: { width:34, height:34, borderRadius:17, background:'rgba(255,255,255,0.1)', border:'none', color:'#fff', fontSize:13, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' },
  addBtn:  { padding:'6px 14px', borderRadius:16, background:'rgba(99,102,241,0.2)', border:'1px solid rgba(99,102,241,0.4)', color:'#a5b4fc', fontSize:12, fontWeight:700, cursor:'pointer' },

  // Middle row: slider + video
  middle:  { flexShrink:0, display:'flex', alignItems:'center', height:VIDEO_H, padding:'6px 0' },

  // Slider
  slider:  { width:36, height:'100%', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'space-between', padding:'4px 0', cursor:'ns-resize', userSelect:'none', touchAction:'none', flexShrink:0 },
  sliderBig:{ fontSize:15, fontWeight:800, color:'rgba(255,255,255,0.5)', lineHeight:1 },
  sliderSm: { fontSize:8,  fontWeight:700, color:'rgba(255,255,255,0.5)', lineHeight:1 },
  track:   { flex:1, width:3, background:'rgba(255,255,255,0.15)', borderRadius:3, margin:'4px 0', position:'relative' },
  thumb:   { position:'absolute', width:18, height:18, background:'#fff', borderRadius:'50%', left:'50%', transform:'translate(-50%,-50%)', boxShadow:'0 2px 8px rgba(0,0,0,0.5)' },

  // Video — 9:16 fixed, centered
  videoWrap:{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', height:'100%', overflow:'hidden' },
  canvas:  {
    // Height = VIDEO_H - padding, width = height * (9/16)
    display:'block',
    height: VIDEO_H - 12,
    width: Math.round((VIDEO_H - 12) * (9/16)),
    touchAction:'none',
    borderRadius:4,
    boxShadow:'0 0 0 1px rgba(255,255,255,0.12)',
    cursor:'crosshair',
  },

  // Tabs
  tabs:    { flexShrink:0, display:'flex', gap:4, padding:'4px 12px', borderTop:'1px solid #2C2C2E', alignItems:'center' },
  tab:     { padding:'4px 12px', fontSize:12, fontWeight:600, cursor:'pointer', border:'none', borderRadius:8 },
  removeTab:{ marginLeft:'auto', padding:'4px 10px', borderRadius:8, border:'none', background:'rgba(239,68,68,0.15)', color:'#f87171', fontSize:11, fontWeight:700, cursor:'pointer' },

  // Colors
  colorRow:{ flexShrink:0, display:'flex', gap:8, padding:'8px 14px', borderTop:'1px solid #2C2C2E', overflowX:'auto' },
  dot:     { width:28, height:28, borderRadius:'50%', flexShrink:0, cursor:'pointer', padding:0, transition:'transform 0.12s' },

  // Input
  inputRow:{ flexShrink:0, display:'flex', alignItems:'flex-start', gap:8, padding:'6px 12px 4px', borderTop:'1px solid #2C2C2E' },
  ta:      { flex:1, background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.12)', borderRadius:10, padding:'9px 12px', fontSize:15, fontWeight:600, color:'#fff', outline:'none', resize:'none', lineHeight:1.4 },
  alignSide:{ width:34, height:34, marginTop:4, flexShrink:0, background:'rgba(255,255,255,0.08)', border:'none', color:'#fff', borderRadius:8, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' },

  // Font strip
  fontRow: { flexShrink:0, display:'flex', overflowX:'auto', borderTop:'1px solid #2C2C2E', paddingBottom:'env(safe-area-inset-bottom,10px)' },
  fontBtn: { flexShrink:0, padding:'10px 14px', fontSize:15, cursor:'pointer', border:'none', borderRadius:0, whiteSpace:'nowrap', lineHeight:1.2, transition:'all 0.12s' },
};
