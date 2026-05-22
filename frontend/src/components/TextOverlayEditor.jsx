import React, { useState, useEffect, useRef, useCallback } from 'react';

const FONTS = ['Arial','Impact','Georgia','Verdana','Courier New'];
const COLORS = ['#ffffff','#000000','#38bdf8','#f97316','#facc15','#f87171','#34d399','#e879f9','#a78bfa','#fb7185'];

const STYLE_PRESETS = [
  { label: 'Clean',   textColor:'#ffffff', bg:'none',  font:'Arial',   fontSize:36 },
  { label: 'Bold',    textColor:'#facc15', bg:'black', font:'Impact',  fontSize:40 },
  { label: 'Caption', textColor:'#ffffff', bg:'dark',  font:'Arial',   fontSize:28 },
  { label: 'Bright',  textColor:'#000000', bg:'white', font:'Verdana', fontSize:30 },
  { label: 'Neon',    textColor:'#38bdf8', bg:'none',  font:'Impact',  fontSize:38 },
  { label: 'Warm',    textColor:'#f97316', bg:'none',  font:'Georgia', fontSize:34 },
];

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function isMobile() { return window.innerWidth < 768; }

export default function TextOverlayEditor({ videoSrc, textBoxes, onChange, onClose }) {

  const makeBox = (raw) => ({
    id:        raw?.id ?? 1,
    lines:     (raw?.text || 'Your Text Here').split('\n'),
    fontSize:  raw?.fontSize ?? 36,
    posX:      raw?.posX ?? (raw?.xPct != null ? Math.round((raw.xPct/100)*600) : 300),
    posY:      raw?.posY ?? (raw?.yPct != null ? Math.round((raw.yPct/100)*400) : 180),
    font:      raw?.font ?? 'Arial',
    textColor: raw?.textColor ?? raw?.colorHex ?? '#ffffff',
    bg:        raw?.bg ?? 'none',
  });

  const [boxes, setBoxes]         = useState(() => textBoxes?.length ? textBoxes.map(makeBox) : [makeBox(null)]);
  const [activeId, setActiveId]   = useState(() => textBoxes?.[0]?.id ?? 1);
  const [activeTab, setActiveTab] = useState('style');
  const [canvasSize, setCanvasSize] = useState({ w: 600, h: 340 });

  const canvasRef  = useRef(null);
  const videoRef   = useRef(null);
  const gestureRef = useRef(null);
  const ptrsRef    = useRef(new Map());
  const stateRef   = useRef({ boxes, activeId });

  useEffect(() => { stateRef.current = { boxes, activeId }; }, [boxes, activeId]);

  useEffect(() => {
    function resize() {
      if (isMobile()) { const w = window.innerWidth; setCanvasSize({ w, h: Math.round(w * 0.56) }); }
      else setCanvasSize({ w: 620, h: 360 });
    }
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  const { w: CW, h: CH } = canvasSize;

  useEffect(() => {
    const out = boxes.map(b => ({
      id: b.id, text: b.lines.join('\n'), fontSize: b.fontSize,
      posX: b.posX, posY: b.posY, font: b.font,
      textColor: b.textColor, colorHex: b.textColor,
      xPct: (b.posX/CW)*100, yPct: (b.posY/CH)*100,
      bg: b.bg, align: 'center', widthPct: 80,
    }));
    onChange(out.filter(b => b.text.trim()));
  }, [boxes, CW, CH]); // eslint-disable-line

  const updateBox = useCallback((id, patch) =>
    setBoxes(p => p.map(b => b.id === id ? {...b,...patch} : b)), []);

  const activeBox = boxes.find(b => b.id === activeId) ?? boxes[0];

  const addBox = () => {
    const id = Date.now();
    const yPos = CH * ([0.3,0.5,0.7][boxes.length % 3]);
    setBoxes(p => [...p, makeBox({ id, text: 'New Text', posX: CW/2, posY: yPos })]);
    setActiveId(id);
    setActiveTab('text');
  };

  const removeBox = (id) => {
    setBoxes(p => { const n = p.filter(b => b.id !== id); return n.length ? n : [makeBox(null)]; });
    setActiveId(p => p === id ? (boxes.find(b => b.id !== id)?.id ?? 1) : p);
  };

  const applyPreset = (preset) => updateBox(activeBox.id, { textColor: preset.textColor, bg: preset.bg, font: preset.font, fontSize: preset.fontSize });
  const updateLine  = (id, li, val) => setBoxes(p => p.map(b => { if (b.id!==id) return b; const lines=[...b.lines]; lines[li]=val; return {...b,lines}; }));
  const addLine     = () => updateBox(activeBox.id, { lines: [...activeBox.lines, ''] });
  const removeLine  = (li) => { const lines = activeBox.lines.filter((_,i) => i!==li); updateBox(activeBox.id, { lines: lines.length ? lines : [''] }); };

  const draw = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { boxes, activeId } = stateRef.current;
    ctx.fillStyle = '#0c0f14'; ctx.fillRect(0,0,CW,CH);
    const vid = videoRef.current;
    if (vid && vid.readyState >= 2) {
      try {
        const vr=vid.videoWidth/vid.videoHeight, cr=CW/CH;
        let dw,dh,ox=0,oy=0;
        if (vr>cr){dh=CH;dw=dh*vr;ox=(CW-dw)/2;}else{dw=CW;dh=dw/vr;oy=(CH-dh)/2;}
        ctx.drawImage(vid,ox,oy,dw,dh);
      } catch(_){}
    }
    boxes.forEach(b => {
      const isActive=b.id===activeId, lh=b.fontSize*1.35, totalH=b.lines.length*lh, sy=b.posY-totalH/2+lh/2;
      ctx.font=`bold ${b.fontSize}px ${b.font}`; ctx.textAlign='center'; ctx.textBaseline='middle';
      b.lines.forEach((line,i) => {
        const ly=sy+i*lh, tw=ctx.measureText(line).width, pad=12;
        if (b.bg!=='none') {
          ctx.fillStyle=b.bg==='black'?'rgba(0,0,0,0.92)':b.bg==='dark'?'rgba(0,0,0,0.68)':b.bg==='white'?'rgba(255,255,255,0.96)':'rgba(255,255,255,0.72)';
          ctx.beginPath(); ctx.roundRect(b.posX-tw/2-pad,ly-b.fontSize/2-6,tw+pad*2,b.fontSize+12,7); ctx.fill();
        }
        ctx.fillStyle='rgba(0,0,0,0.5)'; ctx.fillText(line,b.posX+1.5,ly+1.5);
        ctx.fillStyle=b.textColor; ctx.fillText(line,b.posX,ly);
      });
      if (isActive) {
        const mw=Math.max(...b.lines.map(l=>ctx.measureText(l).width)), pad=18;
        const rx=b.posX-mw/2-pad, ry=b.posY-totalH/2-10, rw=mw+pad*2, rh=totalH+20;
        ctx.shadowColor='#38bdf8'; ctx.shadowBlur=8;
        ctx.strokeStyle='#38bdf8'; ctx.lineWidth=2; ctx.setLineDash([]); ctx.strokeRect(rx,ry,rw,rh);
        ctx.shadowBlur=0;
        [[rx,ry],[rx+rw,ry],[rx,ry+rh],[rx+rw,ry+rh]].forEach(([cx,cy])=>{
          ctx.fillStyle='#fff'; ctx.beginPath(); ctx.arc(cx,cy,5,0,Math.PI*2); ctx.fill();
          ctx.strokeStyle='#38bdf8'; ctx.lineWidth=2; ctx.stroke();
        });
        ctx.font='bold 11px Arial'; ctx.fillStyle='rgba(56,189,248,0.8)'; ctx.textAlign='center';
        ctx.fillText('DRAG TO MOVE', b.posX, ry-9);
      }
    });
  }, [CW, CH]);

  useEffect(() => {
    let raf; const loop=()=>{draw(); raf=requestAnimationFrame(loop);}; raf=requestAnimationFrame(loop);
    return ()=>cancelAnimationFrame(raf);
  }, [draw]);

  function hitTest(box,cx,cy) {
    if (!box||!canvasRef.current) return false;
    const ctx=canvasRef.current.getContext('2d'); ctx.font=`bold ${box.fontSize}px ${box.font}`;
    const mw=Math.max(...box.lines.map(l=>ctx.measureText(l).width)), th=box.lines.length*box.fontSize*1.35, pad=isMobile()?36:22;
    return cx>=box.posX-mw/2-pad&&cx<=box.posX+mw/2+pad&&cy>=box.posY-th/2-pad&&cy<=box.posY+th/2+pad;
  }
  function toCanvas(e){const r=canvasRef.current.getBoundingClientRect(); return{cx:(e.clientX-r.left)*(CW/r.width),cy:(e.clientY-r.top)*(CH/r.height)};}
  function onPointerDown(e){
    e.preventDefault(); try{e.currentTarget.setPointerCapture(e.pointerId);}catch(_){}
    ptrsRef.current.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(ptrsRef.current.size>=2){const pts=[...ptrsRef.current.values()],dist=Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y),box=stateRef.current.boxes.find(b=>b.id===stateRef.current.activeId); gestureRef.current={mode:'pinch',startDist:dist,startFontSize:box?.fontSize??36}; return;}
    const{cx,cy}=toCanvas(e),{boxes}=stateRef.current;
    for(let i=boxes.length-1;i>=0;i--){if(hitTest(boxes[i],cx,cy)){setActiveId(boxes[i].id); gestureRef.current={mode:'drag',startCX:e.clientX,startCY:e.clientY,startPX:boxes[i].posX,startPY:boxes[i].posY,id:boxes[i].id}; return;}}
    gestureRef.current=null;
  }
  function onPointerMove(e){
    const ptr=ptrsRef.current.get(e.pointerId); if(ptr){ptr.x=e.clientX;ptr.y=e.clientY;}
    const g=gestureRef.current; if(!g) return;
    if(g.mode==='drag'){const r=canvasRef.current.getBoundingClientRect(); updateBox(g.id,{posX:clamp(Math.round(g.startPX+(e.clientX-g.startCX)*(CW/r.width)),30,CW-30),posY:clamp(Math.round(g.startPY+(e.clientY-g.startCY)*(CH/r.height)),20,CH-20)});}
    else if(g.mode==='pinch'){const pts=[...ptrsRef.current.values()]; if(pts.length<2)return; updateBox(activeBox?.id,{fontSize:clamp(Math.round(g.startFontSize*Math.hypot(pts[0].x-pts[1].x,pts[0].y-pts[1].y)/g.startDist),14,110)});}
  }
  function onPointerUp(e){ptrsRef.current.delete(e.pointerId); if(ptrsRef.current.size===0)gestureRef.current=null;}

  const ab=activeBox, mob=isMobile();

  return (
    <div style={S.overlay}>
      <div style={S.header}>
        <button onClick={onClose} style={S.iconBtn}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
        <span style={S.headerTitle}>Text Editor</span>
        <button onClick={addBox} style={S.addBtn}>＋ Add</button>
      </div>

      <div style={S.canvasArea}>
        <canvas ref={canvasRef} width={CW} height={CH}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove}
          onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
          style={{width:'100%',maxWidth:CW,display:'block',touchAction:'none',cursor:'grab',borderRadius:mob?0:12,border:mob?'none':'1px solid #1a1f2e'}}/>
        {videoSrc && <video ref={videoRef} src={videoSrc} style={{display:'none'}} loop playsInline muted autoPlay/>}
        {boxes.length>1&&(
          <div style={S.chipRow}>
            {boxes.map((b,i)=>(
              <button key={b.id} onClick={()=>setActiveId(b.id)} style={{...S.chip,...(b.id===activeId?S.chipOn:{})}}>T{i+1}</button>
            ))}
          </div>
        )}
        <div style={S.canvasHint}>👆 Drag · 🤌 Pinch to resize</div>
      </div>

      <div style={mob?S.panelMob:S.panelDesk}>
        <div style={S.tabRow}>
          {[{id:'style',icon:'✦',label:'Style'},{id:'text',icon:'✎',label:'Text'},{id:'position',icon:'⊹',label:'Position'}].map(t=>(
            <button key={t.id} onClick={()=>setActiveTab(t.id)} style={{...S.tabBtn,...(activeTab===t.id?S.tabBtnOn:{})}}>
              <span>{t.icon}</span> {t.label}
            </button>
          ))}
        </div>

        <div style={S.tabContent}>
          {activeTab==='style'&&(
            <div>
              <Label>Quick Styles</Label>
              <div style={S.presetGrid}>
                {STYLE_PRESETS.map(p=>(
                  <button key={p.label} onClick={()=>applyPreset(p)} style={S.presetBtn}>
                    <span style={{fontFamily:p.font,fontSize:13,fontWeight:700,color:p.textColor,background:p.bg==='black'?'#000':p.bg==='dark'?'rgba(0,0,0,0.7)':p.bg==='white'?'#fff':p.bg==='light'?'rgba(255,255,255,0.7)':'transparent',padding:'2px 6px',borderRadius:4}}>{p.label}</span>
                  </button>
                ))}
              </div>
              <Div/>
              <Label>Size — <span style={{color:'#38bdf8'}}>{ab?.fontSize??36}px</span></Label>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <button onClick={()=>updateBox(ab.id,{fontSize:clamp((ab?.fontSize??36)-2,14,110)})} style={S.stepBtn}>−</button>
                <input type="range" min={14} max={110} value={ab?.fontSize??36} onChange={e=>updateBox(ab.id,{fontSize:+e.target.value})} style={S.slider}/>
                <button onClick={()=>updateBox(ab.id,{fontSize:clamp((ab?.fontSize??36)+2,14,110)})} style={S.stepBtn}>+</button>
              </div>
              <Div/>
              <Label>Font</Label>
              <div style={S.fontRow}>
                {FONTS.map(f=><button key={f} onClick={()=>updateBox(ab.id,{font:f})} style={{...S.fontBtn,...(ab?.font===f?S.fontBtnOn:{}),fontFamily:f}}>{f.split(' ')[0]}</button>)}
              </div>
              <Div/>
              <Label>Text Color</Label>
              <div style={S.colorGrid}>
                {COLORS.map(c=><button key={c} onClick={()=>updateBox(ab.id,{textColor:c})} style={{...S.colorBtn,background:c,outline:ab?.textColor===c?'3px solid #38bdf8':'2px solid rgba(255,255,255,0.08)',outlineOffset:2}}/>)}
                <input type="color" value={ab?.textColor??'#ffffff'} onChange={e=>updateBox(ab.id,{textColor:e.target.value})} style={S.cpick}/>
              </div>
              <Div/>
              <Label>Background</Label>
              <div style={S.bgGrid}>
                {[{v:'none',l:'None',p:'transparent'},{v:'dark',l:'Dark',p:'rgba(0,0,0,0.68)'},{v:'black',l:'Black',p:'#000'},{v:'light',l:'Light',p:'rgba(255,255,255,0.72)'},{v:'white',l:'White',p:'#fff'}].map(o=>(
                  <button key={o.v} onClick={()=>updateBox(ab.id,{bg:o.v})} style={{...S.bgBtn,...(ab?.bg===o.v?S.bgBtnOn:{})}}>
                    <span style={{width:12,height:12,borderRadius:3,background:o.p,border:'1px solid rgba(255,255,255,0.15)',display:'inline-block',marginRight:4,verticalAlign:'middle'}}/>
                    {o.l}
                  </button>
                ))}
              </div>
            </div>
          )}

          {activeTab==='text'&&(
            <div>
              <Label>Edit Lines</Label>
              {ab?.lines.map((line,li)=>(
                <div key={li} style={S.lineRow}>
                  <div style={S.lineNum}>{li+1}</div>
                  <textarea value={line} rows={2} onChange={e=>updateLine(ab.id,li,e.target.value)} placeholder={`Line ${li+1}...`} style={S.lineInput} autoFocus={li===0}/>
                  {ab.lines.length>1&&<button onClick={()=>removeLine(li)} style={S.removeLineBtn}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg></button>}
                </div>
              ))}
              <button onClick={addLine} style={S.addLineBtn}>+ Add Line</button>
              <Div/>
              <button onClick={()=>removeBox(ab.id)} style={S.deleteBtn}>🗑 Delete This Text</button>
            </div>
          )}

          {activeTab==='position'&&(
            <div>
              <Label>Horizontal — <span style={{color:'#38bdf8'}}>{Math.round((ab?.posX??CW/2)/CW*100)}%</span></Label>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <span style={S.posIcon}>←</span>
                <input type="range" min={30} max={CW-30} value={ab?.posX??CW/2} onChange={e=>updateBox(ab.id,{posX:+e.target.value})} style={S.slider}/>
                <span style={S.posIcon}>→</span>
              </div>
              <Label style={{marginTop:16}}>Vertical — <span style={{color:'#38bdf8'}}>{Math.round((ab?.posY??CH/2)/CH*100)}%</span></Label>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <span style={S.posIcon}>↑</span>
                <input type="range" min={20} max={CH-20} value={ab?.posY??CH/2} onChange={e=>updateBox(ab.id,{posY:+e.target.value})} style={S.slider}/>
                <span style={S.posIcon}>↓</span>
              </div>
              <Div/>
              <Label>Snap To</Label>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
                {[
                  {l:'↖ Top Left',x:CW*0.2,y:CH*0.15},{l:'↑ Top',x:CW*0.5,y:CH*0.12},{l:'↗ Top Right',x:CW*0.8,y:CH*0.15},
                  {l:'← Left',x:CW*0.2,y:CH*0.5},{l:'⊙ Center',x:CW*0.5,y:CH*0.5},{l:'→ Right',x:CW*0.8,y:CH*0.5},
                  {l:'↙ Bot Left',x:CW*0.2,y:CH*0.85},{l:'↓ Bottom',x:CW*0.5,y:CH*0.85},{l:'↘ Bot Right',x:CW*0.8,y:CH*0.85},
                ].map(snap=>(
                  <button key={snap.l} onClick={()=>updateBox(ab.id,{posX:Math.round(snap.x),posY:Math.round(snap.y)})} style={S.snapBtn}>{snap.l}</button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={S.footer}>
          <button onClick={onClose} style={S.doneBtn}>✓ Done</button>
        </div>
      </div>
    </div>
  );
}

function Label({children,style}){return <div style={{fontSize:11,fontWeight:700,color:'#38bdf8',letterSpacing:'1px',textTransform:'uppercase',marginBottom:10,marginTop:4,...style}}>{children}</div>;}
function Div(){return <div style={{height:1,background:'#1a1f2e',margin:'14px 0'}}/>;}

const S={
  overlay:{position:'fixed',inset:0,zIndex:9999,background:'#0c0f14',display:'flex',flexDirection:'column',fontFamily:'-apple-system,BlinkMacSystemFont,"SF Pro Display",sans-serif',overflow:'hidden'},
  header:{height:54,padding:'0 14px',background:'#0f1320',borderBottom:'1px solid #1a1f2e',display:'flex',alignItems:'center',justifyContent:'space-between',flexShrink:0},
  headerTitle:{fontSize:16,fontWeight:700,color:'#fff',letterSpacing:'-0.3px'},
  iconBtn:{width:36,height:36,borderRadius:10,background:'#1a1f2e',border:'none',color:'#8896b0',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'},
  addBtn:{display:'flex',alignItems:'center',gap:6,padding:'8px 14px',background:'rgba(56,189,248,0.12)',border:'1px solid rgba(56,189,248,0.3)',borderRadius:10,color:'#38bdf8',fontSize:13,fontWeight:700,cursor:'pointer'},
  canvasArea:{flexShrink:0,background:'#000',position:'relative'},
  chipRow:{position:'absolute',top:8,left:8,display:'flex',gap:6},
  chip:{padding:'4px 10px',borderRadius:20,fontSize:12,fontWeight:700,cursor:'pointer',background:'rgba(0,0,0,0.6)',border:'1px solid rgba(255,255,255,0.15)',color:'#8896b0',backdropFilter:'blur(4px)'},
  chipOn:{background:'rgba(56,189,248,0.2)',border:'1px solid #38bdf8',color:'#38bdf8'},
  canvasHint:{textAlign:'center',padding:'6px 0',fontSize:11,color:'rgba(255,255,255,0.2)',background:'#000'},
  panelMob:{flex:1,background:'#0f1320',display:'flex',flexDirection:'column',overflow:'hidden'},
  panelDesk:{flex:1,background:'#0f1320',display:'flex',flexDirection:'column',overflow:'hidden'},
  tabRow:{display:'flex',borderBottom:'1px solid #1a1f2e',flexShrink:0},
  tabBtn:{flex:1,padding:'12px 4px',background:'none',border:'none',borderBottom:'2px solid transparent',color:'#3a4a6a',fontSize:13,fontWeight:600,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',gap:5,transition:'all .15s'},
  tabBtnOn:{color:'#38bdf8',borderBottom:'2px solid #38bdf8',background:'rgba(56,189,248,0.04)'},
  tabContent:{flex:1,overflowY:'auto',padding:'16px 14px 0'},
  presetGrid:{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8,marginBottom:4},
  presetBtn:{padding:'10px 6px',borderRadius:10,background:'#141824',border:'1px solid #1a1f2e',cursor:'pointer',textAlign:'center'},
  slider:{flex:1,accentColor:'#38bdf8',cursor:'pointer',height:4},
  stepBtn:{width:34,height:34,borderRadius:8,background:'#1a1f2e',border:'none',color:'#fff',fontSize:18,fontWeight:700,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0},
  fontRow:{display:'flex',gap:6,flexWrap:'wrap'},
  fontBtn:{padding:'7px 12px',borderRadius:8,background:'#141824',border:'1px solid #1a1f2e',color:'#5a6a8a',fontSize:13,cursor:'pointer',fontWeight:600},
  fontBtnOn:{background:'rgba(56,189,248,0.1)',border:'1px solid #38bdf8',color:'#38bdf8'},
  colorGrid:{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'},
  colorBtn:{width:34,height:34,borderRadius:'50%',border:'none',cursor:'pointer',flexShrink:0},
  cpick:{width:34,height:34,borderRadius:'50%',border:'2px solid #1a1f2e',cursor:'pointer',padding:0,background:'none',flexShrink:0},
  bgGrid:{display:'flex',gap:6,flexWrap:'wrap'},
  bgBtn:{flex:1,minWidth:64,padding:'9px 6px',borderRadius:9,background:'#141824',border:'1px solid #1a1f2e',color:'#4a5a7a',fontSize:12,fontWeight:600,cursor:'pointer',textAlign:'center',display:'flex',alignItems:'center',justifyContent:'center'},
  bgBtnOn:{background:'rgba(249,115,22,0.1)',border:'1px solid #f97316',color:'#f97316'},
  lineRow:{display:'flex',alignItems:'flex-start',gap:8,marginBottom:8},
  lineNum:{width:24,height:24,borderRadius:6,background:'#1a1f2e',color:'#3a4a6a',fontSize:11,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,marginTop:10},
  lineInput:{flex:1,padding:'10px 12px',border:'1.5px solid #1a1f2e',borderRadius:10,fontSize:15,color:'#fff',background:'#141824',outline:'none',resize:'none',lineHeight:1.4,fontFamily:'inherit',minHeight:44},
  removeLineBtn:{width:32,height:32,borderRadius:8,background:'rgba(248,113,113,0.08)',border:'1px solid rgba(248,113,113,0.2)',color:'#f87171',cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,marginTop:8},
  addLineBtn:{width:'100%',padding:'10px',borderRadius:10,background:'#141824',border:'1.5px dashed #1a1f2e',color:'#3a4a6a',fontSize:13,fontWeight:600,cursor:'pointer',marginTop:4},
  deleteBtn:{width:'100%',padding:12,borderRadius:10,background:'rgba(248,113,113,0.06)',border:'1.5px solid rgba(248,113,113,0.2)',color:'#f87171',fontSize:14,fontWeight:600,cursor:'pointer'},
  posIcon:{fontSize:16,color:'#3a4a6a',width:20,textAlign:'center',flexShrink:0},
  snapBtn:{padding:'8px 4px',borderRadius:8,background:'#141824',border:'1px solid #1a1f2e',color:'#4a5a7a',fontSize:11,fontWeight:600,cursor:'pointer',textAlign:'center'},
  footer:{padding:'12px 14px',borderTop:'1px solid #1a1f2e',flexShrink:0,background:'#0f1320'},
  doneBtn:{width:'100%',padding:14,borderRadius:12,background:'linear-gradient(90deg,#38bdf8,#0ea5e9)',border:'none',color:'#fff',fontSize:15,fontWeight:700,cursor:'pointer',boxShadow:'0 4px 16px rgba(56,189,248,0.25)'},
};
