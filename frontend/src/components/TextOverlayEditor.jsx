import React, { useState, useEffect, useRef, useCallback } from 'react';

// Canvas internal res = actual video pixel dimensions (1:1 with what FFmpeg sees)
// The source video already has black bars baked in — we draw the video as-is, no padding

const FONTS = [
  { label: 'Anek Bangla',   value: "'Anek Bangla', sans-serif",      weight: '300', style: 'normal' },
  { label: 'Albert Sans',   value: "'Albert Sans', sans-serif",       weight: '700', style: 'normal' },
  { label: 'Almoneda',      value: "'Playfair Display', serif",       weight: '700', style: 'italic' },
  { label: 'Classic',       value: "'Oswald', sans-serif",            weight: '700', style: 'normal' },
  { label: 'Classic Med',   value: "'Oswald', sans-serif",            weight: '400', style: 'normal' },
  { label: 'Classic Light', value: "'Oswald', sans-serif",            weight: '300', style: 'normal' },
  { label: 'Modern',        value: "'Bebas Neue', sans-serif",        weight: '400', style: 'normal' },
  { label: 'Marker',        value: "'Permanent Marker', cursive",     weight: '400', style: 'normal' },
  { label: 'Pacifico',      value: "'Pacifico', cursive",             weight: '400', style: 'normal' },
  { label: 'Script',        value: "'Dancing Script', cursive",       weight: '700', style: 'normal' },
  { label: 'Exo Light',     value: "'Exo 2', sans-serif",             weight: '200', style: 'normal' },
  { label: 'Rajdhani',      value: "'Rajdhani', sans-serif",          weight: '700', style: 'normal' },
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
    id:          raw?.id ?? uid(),
    text:        raw?.text ?? '',
    fontSizePct: raw?.fontSizePct ?? 0.074,
    xPct:        raw?.xPct ?? (raw?.posX != null ? (raw.posX / 1080) * 100 : 50),
    yPct:        raw?.yPct ?? (raw?.posY != null ? (raw.posY / 1920) * 100 : 15),
    fontIdx:     raw?.fontIdx ?? 0,
    textColor:   raw?.textColor ?? '#FFFFFF',
    bg:          raw?.bg ?? 'none',
    bgW:         raw?.bgW ?? null,
    bgH:         raw?.bgH ?? null,
    align:       raw?.align ?? 'center',
  });

  const [boxes, setBoxes]   = useState(() => textBoxes?.length ? textBoxes.map(makeBox) : [makeBox(null)]);
  const [activeId, setActiveId] = useState(() => textBoxes?.[0]?.id ?? boxes[0]?.id);

  const [vidW, setVidW] = useState(720);
  const [vidH, setVidH] = useState(1280);

  const canvasRef   = useRef(null);
  const videoRef    = useRef(null);
  const gestureRef  = useRef(null);
  const ptrsRef     = useRef(new Map());
  const stateRef    = useRef({ boxes, activeId, vidW:720, vidH:1280 });
  const sliderDrag  = useRef(false);
  const sliderStart = useRef(null);
  const [screenW]   = useState(window.innerWidth);

  useEffect(()=>{
    stateRef.current = { boxes, activeId, vidW, vidH };
  },[boxes, activeId, vidW, vidH]);

  // Detect video dimensions
  useEffect(()=>{
    const vid = videoRef.current;
    if(!vid) return;
    function onMeta(){
      if(vid.videoWidth && vid.videoHeight){
        setVidW(vid.videoWidth);
        setVidH(vid.videoHeight);
        stateRef.current = { ...stateRef.current, vidW:vid.videoWidth, vidH:vid.videoHeight };
      }
    }
    vid.addEventListener('loadedmetadata', onMeta);
    vid.addEventListener('loadeddata', onMeta);
    if(vid.readyState >= 1) onMeta();
    const t = setTimeout(()=>{ if(vid.videoWidth) onMeta(); }, 300);
    return ()=>{
      vid.removeEventListener('loadedmetadata', onMeta);
      vid.removeEventListener('loadeddata', onMeta);
      clearTimeout(t);
    };
  },[videoSrc]);

  // Emit to parent — NOW includes vidW/vidH so backend uses exact pixel coords
  useEffect(()=>{
    const out = boxes.map(b => {
      const font = FONTS[b.fontIdx??0];
      const fontSizePx = Math.round(b.fontSizePct * vidW);
      return {
        id: b.id, text: b.text,
        lines: b.text.split('\n'),
        fontSize: fontSizePx,
        fontSizePct: b.fontSizePct,
        posX: Math.round((b.xPct/100)*vidW),
        posY: Math.round((b.yPct/100)*vidH),
        xPct: b.xPct, yPct: b.yPct,
        vidW, vidH,   // ← ADDED: exact dimensions the canvas used
        font: font.value.replace(/'/g,'').split(',')[0].trim(),
        fontFamily: font.value, fontWeight: font.weight,
        textColor: b.textColor, colorHex: b.textColor,
        bg: b.bg, bgW: b.bgW, bgH: b.bgH, align: b.align, widthPct: 80,
      };
    });
    const filtered = out.filter(b => b.text.trim() || b.bg !== 'none');
    if(!filtered.length) return;
    onChange(filtered);
  },[boxes, vidW, vidH]); // eslint-disable-line

  const updateBox = useCallback((id,patch)=>{
    setBoxes(prev=>prev.map(b=>b.id===id?{...b,...patch}:b));
  },[]);

  const addBox = ()=>{
    const nb = makeBox({ id:uid(), xPct:50, yPct:20 });
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

  function bgCycle(){
    if(!ab) return;
    const next = BGS[(BGS.findIndex(b=>b.v===(ab.bg??'none'))+1) % BGS.length].v;
    const patch = { bg: next };
    if(next !== 'none' && (ab.bgW == null || ab.bg === 'none')){
      patch.bgW = 100;
      patch.bgH = 14;
    }
    updateBox(ab.id, patch);
  }

  // ── DISPLAY SIZE ─────────────────────────────────────────────
  const maxVideoH = Math.round(window.innerHeight * 0.56);
  let dispW = screenW - 38;
  let dispH = Math.round(dispW * vidH / vidW);
  if(dispH > maxVideoH){ dispH = maxVideoH; dispW = Math.round(dispH * vidW / vidH); }

  // ── CANVAS DRAW ──────────────────────────────────────────────
  const draw = useCallback(()=>{
    const canvas = canvasRef.current;
    if(!canvas) return;
    const ctx = canvas.getContext('2d');
    const { boxes, activeId, vidW:CW, vidH:CH } = stateRef.current;

    ctx.fillStyle = '#000';
    ctx.fillRect(0,0,CW,CH);

    const vid = videoRef.current;
    if(vid && vid.readyState >= 2){
      try{ ctx.drawImage(vid, 0, 0, CW, CH); }catch(_){}
    }

    boxes.forEach(b=>{
      const hasAnything = b.text.trim() || b.bg !== 'none';
      if(!hasAnything) return;

      const isActive = b.id === activeId;
      const f = FONTS[b.fontIdx??0];
      const fontSize = Math.round(b.fontSizePct * CW);
      const posX = Math.round((b.xPct/100)*CW);
      const posY = Math.round((b.yPct/100)*CH);
      const align = b.align ?? 'center';
      const maxW  = CW * 0.96;

      ctx.font = `${f.weight} ${fontSize}px ${f.value}`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = align;

      const lines = [];
      (b.text || '').split('\n').forEach(para=>{
        if(!para){ lines.push(''); return; }
        const words = para.split(' ');
        let cur = '';
        words.forEach(w=>{
          const test = cur ? cur+' '+w : w;
          if(ctx.measureText(test).width > maxW && cur){ lines.push(cur); cur=w; }
          else cur = test;
        });
        if(cur) lines.push(cur);
      });

      const lineH  = fontSize * 1.3;
      const totalH = lines.length * lineH;
      const startY = posY - totalH/2 + lineH/2;

      const bgColor = b.bg==='black'?'#000':b.bg==='white'?'#fff':b.bg==='yellow'?'#FFEE00':null;
      const fgColor = (b.bg==='white'||b.bg==='yellow')?'#000':b.textColor;

      if(bgColor){
        let bWidth, bHeight, bgX, bgY;
        if(b.bgW != null || b.bgH != null){
          bWidth  = Math.round(((b.bgW ?? 40)/100) * CW);
          bHeight = Math.round(((b.bgH ?? 12)/100) * CH);
          bgX = posX - bWidth/2;
          bgY = posY - bHeight/2;
        } else {
          const maxTw = lines.length ? Math.max(...lines.map(l=>ctx.measureText(l).width)) : fontSize*4;
          const pad   = Math.round(fontSize * 0.25);
          bWidth  = maxTw + pad*2;
          bHeight = (totalH || fontSize*1.6) + pad*1.2;
          if(align==='center')     bgX = posX - bWidth/2;
          else if(align==='left')  bgX = posX - pad;
          else                     bgX = posX - bWidth + pad;
          bgY = posY - bHeight/2;
        }
        ctx.fillStyle = bgColor;
        ctx.fillRect(bgX, bgY, bWidth, bHeight);
      }

      if(b.text.trim()){
        lines.forEach((line,i)=>{
          ctx.fillStyle = fgColor;
          ctx.fillText(line, posX, startY + i*lineH);
        });
      }

      if(isActive){
        ctx.save();
        let bx, by, bw, bh;
        if(b.bg !== 'none' && (b.bgW != null || b.bgH != null)){
          bw = Math.round(((b.bgW ?? 40)/100) * CW);
          bh = Math.round(((b.bgH ?? 12)/100) * CH);
          bx = posX - bw/2;
          by = posY - bh/2;
        } else {
          const maxTw = lines.length ? Math.max(...lines.map(l=>ctx.measureText(l).width),60) : 60;
          const pad   = Math.round(fontSize * 0.4);
          if(align==='center')     bx = posX - maxTw/2 - pad;
          else if(align==='left')  bx = posX - pad;
          else                     bx = posX - maxTw - pad;
          by = posY - (totalH||fontSize)/2 - pad/2;
          bw = maxTw + pad*2;
          bh = (totalH||fontSize) + pad;
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth   = Math.max(3, fontSize*0.03);
        ctx.setLineDash([10,6]);
        ctx.strokeRect(bx, by, bw, bh);
        ctx.setLineDash([]);
        ctx.restore();
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
    sliderDrag.current  = true;
    sliderStart.current = { y:e.touches?.[0]?.clientY??e.clientY, startPct:ab?.fontSizePct??0.074 };
  }
  useEffect(()=>{
    function onMove(e){
      if(!sliderDrag.current||!sliderStart.current) return;
      e.preventDefault();
      const dy = sliderStart.current.y - (e.touches?.[0]?.clientY??e.clientY);
      updateBox(stateRef.current.activeId,{fontSizePct:clamp(sliderStart.current.startPct+dy*0.0005,0.02,0.20)});
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
  function hitTest(box,cx,cy,CW,CH){
    const px=(box.xPct/100)*CW, py=(box.yPct/100)*CH;
    return cx>=px-CW*0.15 && cx<=px+CW*0.15 && cy>=py-CH*0.08 && cy<=py+CH*0.08;
  }
  function s2c(sx,sy){
    const c=canvasRef.current; if(!c) return{cx:0,cy:0};
    const r=c.getBoundingClientRect();
    const {vidW:CW,vidH:CH}=stateRef.current;
    return{cx:(sx-r.left)*(CW/r.width),cy:(sy-r.top)*(CH/r.height)};
  }
  function onPtrDown(e){
    e.preventDefault();
    try{e.currentTarget.setPointerCapture(e.pointerId);}catch(_){}
    ptrsRef.current.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(ptrsRef.current.size>=2){
      const pts=[...ptrsRef.current.values()];
      const dist=Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y);
      const box=stateRef.current.boxes.find(b=>b.id===stateRef.current.activeId);
      gestureRef.current={mode:'pinch',startDist:dist,startPct:box?.fontSizePct??0.074};
      return;
    }
    const{cx,cy}=s2c(e.clientX,e.clientY);
    const{vidW:CW,vidH:CH,boxes}=stateRef.current;
    for(let i=boxes.length-1;i>=0;i--){
      const box=boxes[i];
      if(hitTest(box,cx,cy,CW,CH)){
        setActiveId(box.id);
        gestureRef.current={mode:'drag',sx:e.clientX,sy:e.clientY,ox:box.xPct,oy:box.yPct,id:box.id,moved:false};
        return;
      }
    }
    if(stateRef.current.boxes.length===1){
      const box=stateRef.current.boxes[0];
      gestureRef.current={mode:'drag',sx:e.clientX,sy:e.clientY,ox:box.xPct,oy:box.yPct,id:box.id,moved:false};
      return;
    }
    gestureRef.current=null;
  }
  function onPtrMove(e){
    const ptr=ptrsRef.current.get(e.pointerId);
    if(ptr){ptr.x=e.clientX;ptr.y=e.clientY;}
    const g=gestureRef.current; if(!g) return;
    if(g.mode==='drag'){
      const dx=e.clientX-g.sx, dy=e.clientY-g.sy;
      if(Math.abs(dx)>1||Math.abs(dy)>1) g.moved=true;
      if(!g.moved) return;
      const r=canvasRef.current?.getBoundingClientRect(); if(!r) return;
      updateBox(g.id,{
        xPct:clamp(g.ox+(dx/r.width)*100,  2, 98),
        yPct:clamp(g.oy+(dy/r.height)*100, 2, 98),
      });
    } else if(g.mode==='pinch'){
      const pts=[...ptrsRef.current.values()];
      if(pts.length<2) return;
      const dist=Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y);
      updateBox(stateRef.current.activeId,{fontSizePct:clamp(g.startPct*(dist/g.startDist),0.02,0.18)});
    }
  }
  function onPtrUp(e){
    ptrsRef.current.delete(e.pointerId);
    if(ptrsRef.current.size===0) gestureRef.current=null;
  }

  const sliderPct  = 1-((ab?.fontSizePct??0.074)-0.02)/(0.18-0.02);
  const alignCycle = ()=>updateBox(ab?.id,{align:{left:'center',center:'right',right:'left'}[ab?.align??'center']});

  return(
    <div style={S.root}>
      {videoSrc && (
        <video ref={videoRef} src={videoSrc} style={{display:'none'}} loop playsInline muted autoPlay/>
      )}

      <div style={S.topBar}>
        <button onClick={onClose} style={S.btnDone}>Done</button>
        <div style={S.topMid}>
          <button onClick={alignCycle} style={S.iconBtn}><AlignIcon align={ab?.align??'center'}/></button>
          <button onClick={bgCycle} style={{
            ...S.iconBtn,
            background:hasBg?bgObj.bg:'rgba(255,255,255,0.1)',
            border:'1.5px solid rgba(255,255,255,0.3)',
            color:bgObj.fg, fontSize:10, fontWeight:800,
          }}>BG</button>
          <button onClick={addBox} style={S.addBtn}>+ Text</button>
        </div>
        <button onClick={onClose} style={S.btnSave}>Save</button>
      </div>

      <div style={S.videoRow}>
        <div style={{...S.sliderCol, height:dispH}} onMouseDown={startSlider} onTouchStart={startSlider}>
          <span style={S.sA}>A</span>
          <div style={S.sTrack}><div style={{...S.sThumb, top:`${sliderPct*78+4}%`}}/></div>
          <span style={S.sA2}>A</span>
        </div>
        <div style={{width:dispW, height:dispH, position:'relative', flexShrink:0, background:'#000', overflow:'hidden'}}>
          <canvas
            ref={canvasRef}
            width={vidW} height={vidH}
            onPointerDown={onPtrDown} onPointerMove={onPtrMove}
            onPointerUp={onPtrUp} onPointerCancel={onPtrUp}
            style={{position:'absolute',inset:0,width:'100%',height:'100%',touchAction:'none',cursor:'crosshair',display:'block'}}
          />
        </div>
      </div>

      <div style={S.controls}>
        {boxes.length>1 && (
          <div style={S.tabRow}>
            {boxes.map((b,i)=>(
              <button key={b.id} onClick={()=>setActiveId(b.id)} style={{
                ...S.tab,
                color:       b.id===activeId?'#fff':'#555',
                borderBottom:b.id===activeId?'2px solid #fff':'2px solid transparent',
              }}>Text {i+1}</button>
            ))}
            <button onClick={()=>removeBox(activeId)} style={S.removeBtn}>✕</button>
          </div>
        )}
        <div style={S.divider}/>
        <div style={S.colorRow}>
          {COLORS.map(c=>(
            <button key={c} onClick={()=>updateBox(ab?.id,{textColor:c})} style={{
              ...S.dot, background:c,
              border:    ab?.textColor===c?'3px solid #fff':c==='#FFFFFF'?'1.5px solid #555':'2px solid transparent',
              transform: ab?.textColor===c?'scale(1.28)':'scale(1)',
            }}/>
          ))}
        </div>
        <div style={S.inputRow}>
          <textarea
            value={ab?.text??''}
            onChange={e=>updateBox(ab?.id,{text:e.target.value})}
            rows={2}
            style={{
              ...S.ta,
              fontFamily:font?.value, fontWeight:font?.weight, fontStyle:font?.style,
              textAlign: ab?.align??'center',
            }}
            placeholder="Type your text..."
            autoFocus
          />
          <button onClick={alignCycle} style={S.alignBtn}><AlignIcon align={ab?.align??'center'}/></button>
        </div>

        {hasBg && (
          <div style={S.bgSizeRow}>
            <span style={S.bgSizeLabel}>Cover W</span>
            <input type="range" min={5} max={100} step={1}
              value={ab?.bgW ?? 100}
              onChange={e=>updateBox(ab?.id,{bgW:Number(e.target.value)})}
              style={S.bgSlider}/>
            <span style={S.bgSizeVal}>{ab?.bgW ?? 100}%</span>
            <span style={{...S.bgSizeLabel, marginLeft:10}}>H</span>
            <input type="range" min={3} max={60} step={1}
              value={ab?.bgH ?? 14}
              onChange={e=>updateBox(ab?.id,{bgH:Number(e.target.value)})}
              style={S.bgSlider}/>
            <span style={S.bgSizeVal}>{ab?.bgH ?? 14}%</span>
          </div>
        )}

        <div style={S.fontRow}>
          {FONTS.map((f,i)=>(
            <button key={f.label} onClick={()=>updateBox(ab?.id,{fontIdx:i})} style={{
              ...S.fontBtn,
              fontFamily:f.value, fontWeight:f.weight, fontStyle:f.style,
              color:       (ab?.fontIdx??0)===i?'#fff':'#666',
              borderBottom:(ab?.fontIdx??0)===i?'2px solid #fff':'2px solid transparent',
              background:  (ab?.fontIdx??0)===i?'rgba(255,255,255,0.08)':'transparent',
            }}>{f.label}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

function AlignIcon({align}){
  return align==='left'
    ?<svg width="15" height="12" viewBox="0 0 24 18" fill="none"><path d="M2 3h20M2 9h13M2 15h16" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/></svg>
    :align==='center'
    ?<svg width="15" height="12" viewBox="0 0 24 18" fill="none"><path d="M2 3h20M5 9h14M3 15h18" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/></svg>
    :<svg width="15" height="12" viewBox="0 0 24 18" fill="none"><path d="M2 3h20M9 9h13M6 15h16" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/></svg>;
}

const S = {
  root:       { position:'fixed', inset:0, zIndex:9999, background:'#1C1C1E', display:'flex', flexDirection:'column', fontFamily:'-apple-system,BlinkMacSystemFont,sans-serif', overflow:'hidden' },
  topBar:     { flexShrink:0, height:52, display:'flex', alignItems:'center', justifyContent:'space-between', padding:'0 16px', paddingTop:'env(safe-area-inset-top,0px)', borderBottom:'1px solid #2C2C2E' },
  btnDone:    { background:'transparent', border:'none', color:'#999', fontSize:15, fontWeight:600, cursor:'pointer' },
  btnSave:    { background:'transparent', border:'none', color:'#fff', fontSize:15, fontWeight:700, cursor:'pointer' },
  topMid:     { display:'flex', gap:10, alignItems:'center' },
  iconBtn:    { width:36, height:36, borderRadius:18, background:'rgba(255,255,255,0.1)', border:'none', color:'#fff', fontSize:13, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' },
  addBtn:     { padding:'7px 16px', borderRadius:18, background:'rgba(99,102,241,0.2)', border:'1px solid rgba(99,102,241,0.4)', color:'#a5b4fc', fontSize:13, fontWeight:700, cursor:'pointer' },
  videoRow:   { flexShrink:0, display:'flex', flexDirection:'row', background:'#000', justifyContent:'center', alignItems:'center' },
  sliderCol:  { width:38, flexShrink:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'space-between', padding:'8px 0', cursor:'ns-resize', userSelect:'none', touchAction:'none', background:'#111' },
  sA:         { fontSize:15, fontWeight:800, color:'rgba(255,255,255,0.5)', lineHeight:1 },
  sA2:        { fontSize:8,  fontWeight:700, color:'rgba(255,255,255,0.5)', lineHeight:1 },
  sTrack:     { flex:1, width:3, background:'rgba(255,255,255,0.15)', borderRadius:3, margin:'6px 0', position:'relative' },
  sThumb:     { position:'absolute', width:20, height:20, background:'#fff', borderRadius:'50%', left:'50%', transform:'translate(-50%,-50%)', boxShadow:'0 2px 8px rgba(0,0,0,0.5)' },
  controls:   { flex:1, display:'flex', flexDirection:'column', overflow:'hidden', minHeight:0 },
  tabRow:     { flexShrink:0, display:'flex', gap:4, padding:'4px 12px', alignItems:'center', overflowX:'auto' },
  tab:        { padding:'5px 14px', fontSize:12, fontWeight:600, cursor:'pointer', border:'none', borderRadius:0, background:'transparent', flexShrink:0 },
  removeBtn:  { marginLeft:'auto', padding:'5px 12px', borderRadius:12, border:'none', background:'rgba(239,68,68,0.15)', color:'#f87171', fontSize:11, fontWeight:700, cursor:'pointer' },
  divider:    { height:1, background:'#2C2C2E', flexShrink:0 },
  colorRow:   { flexShrink:0, display:'flex', gap:9, padding:'10px 14px', overflowX:'auto', borderBottom:'1px solid #2C2C2E' },
  dot:        { width:28, height:28, borderRadius:'50%', flexShrink:0, cursor:'pointer', padding:0, transition:'transform 0.12s' },
  inputRow:   { flexShrink:0, display:'flex', alignItems:'flex-start', gap:8, padding:'8px 12px 6px' },
  ta:         { flex:1, background:'rgba(255,255,255,0.07)', border:'1px solid rgba(255,255,255,0.12)', borderRadius:12, padding:'10px 12px', fontSize:16, fontWeight:600, color:'#fff', outline:'none', resize:'none', lineHeight:1.4 },
  alignBtn:   { width:36, height:36, marginTop:2, flexShrink:0, background:'rgba(255,255,255,0.08)', border:'none', color:'#fff', borderRadius:10, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' },
  fontRow:    { flexShrink:0, display:'flex', overflowX:'auto', borderTop:'1px solid #2C2C2E', paddingBottom:'env(safe-area-inset-bottom,10px)' },
  fontBtn:    { flexShrink:0, padding:'10px 14px', fontSize:15, cursor:'pointer', border:'none', borderRadius:0, whiteSpace:'nowrap', lineHeight:1.2, transition:'all 0.12s' },
  bgSizeRow:  { flexShrink:0, display:'flex', alignItems:'center', gap:6, padding:'6px 14px', borderTop:'1px solid #2C2C2E', background:'rgba(0,0,0,0.2)' },
  bgSizeLabel:{ fontSize:11, color:'#888', whiteSpace:'nowrap', fontWeight:600 },
  bgSizeVal:  { fontSize:11, color:'#fff', minWidth:30, textAlign:'right', fontWeight:600 },
  bgSlider:   { flex:1, accentColor:'#fff', cursor:'pointer', height:3 },
};
