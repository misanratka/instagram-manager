import React, { useState, useEffect, useRef, useCallback } from 'react';

const FONTS = ['Arial', 'Georgia', 'Courier New', 'Verdana', 'Times New Roman', 'Comic Sans MS', 'Impact'];
const CANVAS_W = 600;
const CANVAS_H = 400;
const GRID = 50;

export default function TextOverlayEditor({ videoSrc, textBoxes, onChange, onClose }) {
  const init = textBoxes[0];
  const [text, setText]           = useState(init?.text || 'Add Your Text Here');
  const [fontSize, setFontSize]   = useState(init?.fontSize || 36);
  const [posX, setPosX]           = useState(
    init?.posX ?? (init?.xPct != null ? Math.round((init.xPct / 100) * CANVAS_W) : 127)
  );
  const [posY, setPosY]           = useState(
    init?.posY ?? (init?.yPct != null ? Math.round((init.yPct / 100) * CANVAS_H) : 150)
  );
  const [font, setFont]           = useState(init?.font || 'Arial');
  const [textColor, setTextColor] = useState(init?.textColor || init?.colorHex || '#ffffff');
  const [bgColor, setBgColor]     = useState('#000000');
  const [showExport, setShowExport]   = useState(false);
  const [copied, setCopied]           = useState(false);

  const canvasRef  = useRef(null);
  const videoRef   = useRef(null);
  const gestureRef = useRef(null);
  const ptrsRef    = useRef(new Map());
  const stateRef   = useRef({ text, fontSize, posX, posY, font, textColor });

  useEffect(() => {
    stateRef.current = { text, fontSize, posX, posY, font, textColor };
  }, [text, fontSize, posX, posY, font, textColor]);

  // Sync to parent
  useEffect(() => {
    const box = {
      id: init?.id || 1,
      text, fontSize, posX, posY, font, textColor,
      colorHex: textColor,
      xPct: (posX / CANVAS_W) * 100,
      yPct: (posY / CANVAS_H) * 100,
      bg: 'none', align: 'center', widthPct: 80,
    };
    onChange(text.trim() ? [box] : []);
  }, [text, fontSize, posX, posY, font, textColor]); // eslint-disable-line

  // Canvas draw
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const { text, fontSize, posX, posY, font, textColor } = stateRef.current;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    const vid = videoRef.current;
    if (vid && vid.readyState >= 2) {
      try { ctx.drawImage(vid, 0, 0, CANVAS_W, CANVAS_H); } catch (_) {}
    }

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 0.5;
    for (let x = GRID; x < CANVAS_W; x += GRID) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CANVAS_H); ctx.stroke();
    }
    for (let y = GRID; y < CANVAS_H; y += GRID) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(CANVAS_W, y); ctx.stroke();
    }

    if (!text) return;

    ctx.font = `bold ${fontSize}px ${font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const tw  = ctx.measureText(text).width;
    const th  = fontSize * 1.2;
    const pad = 8;

    // Gold bounding box
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 2;
    ctx.strokeRect(posX - tw / 2 - pad, posY - th / 2 - pad / 2, tw + pad * 2, th + pad);

    ctx.fillStyle = textColor;
    ctx.fillText(text, posX, posY);
  }, []);

  useEffect(() => {
    let raf;
    const loop = () => { draw(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [draw]);

  function hitTest(cx, cy) {
    const canvas = canvasRef.current;
    if (!canvas || !stateRef.current.text) return false;
    const ctx = canvas.getContext('2d');
    const { text, fontSize, posX, posY, font } = stateRef.current;
    ctx.font = `bold ${fontSize}px ${font}`;
    const tw  = ctx.measureText(text).width;
    const th  = fontSize * 1.2;
    const pad = 20;
    return cx >= posX - tw / 2 - pad && cx <= posX + tw / 2 + pad &&
           cy >= posY - th / 2 - pad && cy <= posY + th / 2 + pad;
  }

  function toCanvas(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    return {
      cx: (e.clientX - rect.left) * (CANVAS_W / rect.width),
      cy: (e.clientY - rect.top)  * (CANVAS_H / rect.height),
    };
  }

  function onPointerDown(e) {
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
    ptrsRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const { cx, cy } = toCanvas(e);

    if (ptrsRef.current.size >= 2) {
      const pts  = [...ptrsRef.current.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      gestureRef.current = { mode: 'pinch', startDist: dist, startFontSize: stateRef.current.fontSize };
    } else if (hitTest(cx, cy)) {
      gestureRef.current = {
        mode: 'drag',
        startCX: e.clientX, startCY: e.clientY,
        startPX: stateRef.current.posX, startPY: stateRef.current.posY,
      };
    } else {
      gestureRef.current = null;
    }
  }

  function onPointerMove(e) {
    const ptr = ptrsRef.current.get(e.pointerId);
    if (ptr) { ptr.x = e.clientX; ptr.y = e.clientY; }
    const g = gestureRef.current;
    if (!g) return;

    if (g.mode === 'drag') {
      const rect = canvasRef.current.getBoundingClientRect();
      const sx = CANVAS_W / rect.width;
      const sy = CANVAS_H / rect.height;
      setPosX(v => Math.round(Math.max(10, Math.min(CANVAS_W - 10, g.startPX + (e.clientX - g.startCX) * sx))));
      setPosY(v => Math.round(Math.max(10, Math.min(CANVAS_H - 10, g.startPY + (e.clientY - g.startCY) * sy))));
    } else if (g.mode === 'pinch') {
      const pts = [...ptrsRef.current.values()];
      if (pts.length < 2) return;
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      setFontSize(Math.max(16, Math.min(120, Math.round(g.startFontSize * dist / g.startDist))));
    }
  }

  function onPointerUp(e) {
    ptrsRef.current.delete(e.pointerId);
    if (ptrsRef.current.size === 0) gestureRef.current = null;
  }

  function exportJSON() {
    return JSON.stringify({
      text, fontSize,
      position: { x: posX, y: posY },
      colors: { text: textColor, background: bgColor },
      font,
      timestamp: new Date().toISOString(),
    }, null, 2);
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(exportJSON());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: '#fff', display: 'flex', flexDirection: 'column', overflowY: 'auto', fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif' }}>

      {/* Header */}
      <div style={{ padding: '20px 24px 0', flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ fontSize: 30, fontWeight: 700, color: '#c0c0c0', margin: 0, letterSpacing: '-0.02em' }}>
              Text Gesture Editor
            </h1>
            <p style={{ fontSize: 13, color: '#aaa', margin: '4px 0 0' }}>
              Pinch with 2 fingers to resize • Drag to move • Touch-optimized
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'linear-gradient(135deg,#833ab4,#fd1d1d)', border: 'none', borderRadius: 8, color: '#fff', padding: '9px 20px', fontWeight: 700, cursor: 'pointer', fontSize: 14, flexShrink: 0, marginTop: 4 }}>
            Done
          </button>
        </div>
        {/* Divider line */}
        <div style={{ height: 2, background: '#222', margin: '14px 0 0', borderRadius: 1 }} />
      </div>

      {/* Canvas */}
      <div style={{ padding: '16px 24px 6px', flexShrink: 0 }}>
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          style={{ width: '100%', maxWidth: 700, display: 'block', margin: '0 auto', touchAction: 'none', borderRadius: 10, border: '1px solid #1a1a1a', cursor: 'crosshair' }}
        />
        {videoSrc && (
          <video ref={videoRef} src={videoSrc} style={{ display: 'none' }} loop playsInline muted autoPlay />
        )}
        <p style={{ textAlign: 'center', fontSize: 13, color: '#f59e0b', margin: '10px 0 0', fontWeight: 500 }}>
          👆 2 fingers to resize • 1 finger to move
        </p>
      </div>

      {/* Controls card */}
      <div style={{ padding: '8px 24px 32px', flexShrink: 0 }}>
        <div style={{ maxWidth: 700, margin: '0 auto', background: '#fff', border: '1.5px solid #e5e7eb', borderRadius: 14, padding: '20px 20px 18px' }}>

          <Field label="TEXT CONTENT">
            <input
              value={text}
              onChange={e => setText(e.target.value.slice(0, 80))}
              placeholder="Add Your Text Here"
              style={{ width: '100%', padding: '10px 14px', border: '1.5px solid #e5e7eb', borderRadius: 8, fontSize: 15, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', color: '#111' }}
            />
          </Field>

          <Field label={`FONT SIZE: ${fontSize}PX`}>
            <input type="range" min={16} max={120} value={fontSize}
              onChange={e => setFontSize(+e.target.value)}
              style={{ width: '100%', accentColor: '#2563eb' }} />
          </Field>

          <Field label={`POSITION X: ${posX}PX`}>
            <input type="range" min={0} max={CANVAS_W} value={posX}
              onChange={e => setPosX(+e.target.value)}
              style={{ width: '100%', accentColor: '#2563eb' }} />
          </Field>

          <Field label={`POSITION Y: ${posY}PX`}>
            <input type="range" min={0} max={CANVAS_H} value={posY}
              onChange={e => setPosY(+e.target.value)}
              style={{ width: '100%', accentColor: '#2563eb' }} />
          </Field>

          {/* Section divider */}
          <div style={{ height: 1, background: '#f0f0f0', margin: '10px 0 14px' }} />

          <Field label="FONT FAMILY">
            <select value={font} onChange={e => setFont(e.target.value)}
              style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e5e7eb', borderRadius: 8, fontSize: 14, background: '#fff', cursor: 'pointer', outline: 'none', color: '#111' }}>
              {FONTS.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </Field>

          <div style={{ display: 'flex', gap: 14 }}>
            <div style={{ flex: 1 }}>
              <Field label="TEXT COLOR">
                <input type="color" value={textColor} onChange={e => setTextColor(e.target.value)}
                  style={{ width: '100%', height: 42, border: '1.5px solid #e5e7eb', borderRadius: 8, cursor: 'pointer', padding: 3 }} />
              </Field>
            </div>
            <div style={{ flex: 1 }}>
              <Field label="BACKGROUND">
                <input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)}
                  style={{ width: '100%', height: 42, border: '1.5px solid #e5e7eb', borderRadius: 8, cursor: 'pointer', padding: 3 }} />
              </Field>
            </div>
          </div>

          {/* Section divider */}
          <div style={{ height: 1, background: '#f0f0f0', margin: '10px 0 14px' }} />

          <button
            onClick={() => setShowExport(v => !v)}
            style={{ width: '100%', padding: '11px', background: '#111827', border: 'none', borderRadius: 8, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            📋 Export Settings
          </button>

          {showExport && (
            <div style={{ marginTop: 12 }}>
              <pre style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: 14, fontSize: 12, overflow: 'auto', maxHeight: 220, color: '#374151', margin: 0 }}>
                {exportJSON()}
              </pre>
              <button onClick={handleCopy}
                style={{ marginTop: 8, padding: '8px 18px', background: copied ? '#16a34a' : '#2563eb', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'background .2s' }}>
                {copied ? '✓ Copied!' : 'Copy to Clipboard'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', letterSpacing: '0.07em', marginBottom: 6 }}>
        {label}
      </div>
      {children}
    </div>
  );
}
