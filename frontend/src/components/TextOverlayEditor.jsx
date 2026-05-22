import { useState, useRef, useCallback, useEffect } from "react";

/**
 * TextOverlayEditor
 * Drop-in replacement for the old single-line text overlay UI.
 *
 * Props (same shape as before so parent doesn't need changes):
 *   textOverlays  – array of overlay objects (managed externally or use internal state)
 *   onOverlaysChange(overlays) – called whenever overlays change
 *   containerStyle – optional extra style for the wrapper div
 *
 * Each overlay object:
 *   { id, lines: string[], x, y, fontSize, color, bg, fontFamily, selected }
 *
 * NEW features vs old:
 *   ✅ Drag text anywhere on the canvas
 *   ✅ Pinch-to-resize (touch) / scroll-to-resize (desktop)
 *   ✅ Split a line → tap the "⏎ split" button while a word position is chosen, OR
 *      click/tap anywhere inside the text label to place cursor, then hit Enter-split
 *   ✅ Merge lines back (backspace on empty first char of line 2)
 *   ✅ Per-overlay: color, background, font size, font family
 *   ✅ Multiple overlays supported
 */

const FONTS = ["Default", "Serif", "Mono", "Cursive", "Impact"];
const FONT_MAP = {
  Default: "'Helvetica Neue', Arial, sans-serif",
  Serif: "Georgia, 'Times New Roman', serif",
  Mono: "'Courier New', Courier, monospace",
  Cursive: "'Dancing Script', cursive",
  Impact: "Impact, 'Arial Narrow', sans-serif",
};
const BG_OPTIONS = ["none", "black", "white", "semi"];
const COLOR_OPTIONS = ["#ffffff", "#000000", "#facc15", "#f87171", "#34d399", "#60a5fa", "#e879f9"];

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

export default function TextOverlayEditor({
  textOverlays: externalOverlays,
  onOverlaysChange,
  containerStyle = {},
}) {
  // ── State ────────────────────────────────────────────────────────────────
  const [overlays, setOverlays] = useState(
    externalOverlays ?? [
      {
        id: uid(),
        lines: ["Add Your Text Here"],
        x: 50,   // percent of canvas width
        y: 45,   // percent of canvas height
        fontSize: 32,
        color: "#ffffff",
        bg: "none",
        fontFamily: "Default",
        selected: true,
      },
    ]
  );

  const [activeId, setActiveId] = useState(overlays[0]?.id ?? null);
  const [editingId, setEditingId] = useState(null); // which overlay's textarea is open
  const [splitCursor, setSplitCursor] = useState(null); // { id, lineIdx, charIdx }

  const canvasRef = useRef(null);
  const dragState = useRef(null);   // { id, startX, startY, origX, origY }
  const pinchState = useRef(null);  // { id, startDist, origFontSize }

  // Sync external → internal
  useEffect(() => {
    if (externalOverlays) setOverlays(externalOverlays);
  }, [externalOverlays]);

  const emit = useCallback(
    (next) => {
      setOverlays(next);
      onOverlaysChange?.(next);
    },
    [onOverlaysChange]
  );

  const updateOverlay = useCallback(
    (id, patch) => {
      emit((prev) => prev.map((o) => (o.id === id ? { ...o, ...patch } : o)));
    },
    [emit]
  );

  const activeOverlay = overlays.find((o) => o.id === activeId);

  // ── Add new text block ───────────────────────────────────────────────────
  const addText = () => {
    const newId = uid();
    const fresh = {
      id: newId,
      lines: ["New Text"],
      x: 40 + Math.random() * 20,
      y: 40 + Math.random() * 20,
      fontSize: 28,
      color: "#ffffff",
      bg: "none",
      fontFamily: "Default",
      selected: true,
    };
    emit([...overlays.map((o) => ({ ...o, selected: false })), fresh]);
    setActiveId(newId);
    setEditingId(newId);
  };

  // ── Delete active overlay ────────────────────────────────────────────────
  const deleteActive = () => {
    if (!activeId) return;
    const next = overlays.filter((o) => o.id !== activeId);
    emit(next);
    setActiveId(next[0]?.id ?? null);
    setEditingId(null);
  };

  // ── Drag (mouse + touch) ─────────────────────────────────────────────────
  const getCanvasRect = () => canvasRef.current?.getBoundingClientRect();

  const startDrag = (e, id) => {
    if (editingId === id) return; // don't drag while editing text
    e.preventDefault();
    const touch = e.touches?.[0] ?? e;
    const rect = getCanvasRect();
    const o = overlays.find((x) => x.id === id);
    dragState.current = {
      id,
      startX: touch.clientX,
      startY: touch.clientY,
      origX: o.x,
      origY: o.y,
      rectW: rect.width,
      rectH: rect.height,
    };
    setActiveId(id);
  };

  const onMove = useCallback(
    (e) => {
      // ── drag ──
      if (dragState.current) {
        const touch = e.touches?.[0] ?? e;
        const d = dragState.current;
        const dx = ((touch.clientX - d.startX) / d.rectW) * 100;
        const dy = ((touch.clientY - d.startY) / d.rectH) * 100;
        updateOverlay(d.id, {
          x: clamp(d.origX + dx, 0, 95),
          y: clamp(d.origY + dy, 0, 95),
        });
      }
      // ── pinch ──
      if (pinchState.current && e.touches?.length === 2) {
        const [t1, t2] = e.touches;
        const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        const p = pinchState.current;
        const ratio = dist / p.startDist;
        updateOverlay(p.id, { fontSize: clamp(Math.round(p.origFontSize * ratio), 10, 120) });
      }
    },
    [updateOverlay]
  );

  const endDrag = useCallback(() => {
    dragState.current = null;
    pinchState.current = null;
  }, []);

  const startPinch = (e, id) => {
    if (e.touches?.length !== 2) return;
    const [t1, t2] = e.touches;
    const dist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    const o = overlays.find((x) => x.id === id);
    pinchState.current = { id, startDist: dist, origFontSize: o.fontSize };
  };

  // wheel to resize on desktop
  const onWheel = (e, id) => {
    e.preventDefault();
    const o = overlays.find((x) => x.id === id);
    if (!o) return;
    updateOverlay(id, { fontSize: clamp(o.fontSize - Math.sign(e.deltaY) * 2, 10, 120) });
  };

  useEffect(() => {
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("mouseup", endDrag);
    window.addEventListener("touchend", endDrag);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("mouseup", endDrag);
      window.removeEventListener("touchend", endDrag);
    };
  }, [onMove, endDrag]);

  // ── Line split feature ───────────────────────────────────────────────────
  // When editing, hitting Enter inside a textarea splits at cursor position.
  // We intercept keydown on the hidden textarea.
  const handleTextareaKeyDown = (e, id, lineIdx) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const el = e.target;
      const cursor = el.selectionStart;
      splitLineAtCursor(id, lineIdx, cursor);
    }
    if (e.key === "Backspace") {
      const el = e.target;
      if (el.selectionStart === 0 && lineIdx > 0) {
        e.preventDefault();
        mergeLineUp(id, lineIdx);
      }
    }
  };

  const splitLineAtCursor = (id, lineIdx, charIdx) => {
    const o = overlays.find((x) => x.id === id);
    if (!o) return;
    const lines = [...o.lines];
    const line = lines[lineIdx];
    const before = line.slice(0, charIdx);
    const after = line.slice(charIdx);
    lines.splice(lineIdx, 1, before, after);
    updateOverlay(id, { lines });
  };

  const mergeLineUp = (id, lineIdx) => {
    const o = overlays.find((x) => x.id === id);
    if (!o || lineIdx === 0) return;
    const lines = [...o.lines];
    lines[lineIdx - 1] = lines[lineIdx - 1] + lines[lineIdx];
    lines.splice(lineIdx, 1);
    updateOverlay(id, { lines });
  };

  const updateLine = (id, lineIdx, value) => {
    const o = overlays.find((x) => x.id === id);
    if (!o) return;
    const lines = [...o.lines];
    lines[lineIdx] = value;
    updateOverlay(id, { lines });
  };

  // Quick split button: splits first line at midpoint (no cursor needed)
  const quickSplitLine = (id, lineIdx) => {
    const o = overlays.find((x) => x.id === id);
    if (!o) return;
    const line = o.lines[lineIdx];
    // split at last space before midpoint for clean word wrap
    const mid = Math.floor(line.length / 2);
    let splitAt = line.lastIndexOf(" ", mid);
    if (splitAt <= 0) splitAt = mid;
    splitLineAtCursor(id, lineIdx, splitAt);
  };

  // ── Toolbar controls ─────────────────────────────────────────────────────
  const toolbar = activeOverlay && (
    <div style={styles.toolbar}>
      {/* Font size */}
      <label style={styles.toolLabel}>
        Size
        <input
          type="range" min={10} max={100} value={activeOverlay.fontSize}
          onChange={(e) => updateOverlay(activeId, { fontSize: Number(e.target.value) })}
          style={styles.slider}
        />
        <span style={styles.toolValue}>{activeOverlay.fontSize}px</span>
      </label>

      {/* Color */}
      <label style={styles.toolLabel}>
        Color
        <div style={styles.swatchRow}>
          {COLOR_OPTIONS.map((c) => (
            <button
              key={c}
              onClick={() => updateOverlay(activeId, { color: c })}
              style={{
                ...styles.swatch,
                background: c,
                outline: activeOverlay.color === c ? "2px solid #fff" : "none",
              }}
            />
          ))}
        </div>
      </label>

      {/* BG */}
      <label style={styles.toolLabel}>
        BG
        <div style={styles.swatchRow}>
          {BG_OPTIONS.map((b) => (
            <button
              key={b}
              onClick={() => updateOverlay(activeId, { bg: b })}
              style={{
                ...styles.bgBtn,
                outline: activeOverlay.bg === b ? "2px solid #60a5fa" : "none",
              }}
            >
              {b === "none" ? "○" : b === "black" ? "■" : b === "white" ? "□" : "▨"}
            </button>
          ))}
        </div>
      </label>

      {/* Font */}
      <label style={styles.toolLabel}>
        Font
        <select
          value={activeOverlay.fontFamily}
          onChange={(e) => updateOverlay(activeId, { fontFamily: e.target.value })}
          style={styles.select}
        >
          {FONTS.map((f) => <option key={f}>{f}</option>)}
        </select>
      </label>

      {/* Delete */}
      <button onClick={deleteActive} style={styles.deleteBtn}>✕ Remove</button>
    </div>
  );

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ ...styles.root, ...containerStyle }}>
      {/* Top bar */}
      <div style={styles.topBar}>
        <span style={styles.hint}>Drag text • Scroll/pinch to resize • Tap text to edit</span>
        <button onClick={addText} style={styles.addBtn}>+ Add Text</button>
      </div>

      {/* Canvas */}
      <div
        ref={canvasRef}
        style={styles.canvas}
        onClick={(e) => {
          // clicking the canvas background deselects
          if (e.target === canvasRef.current) {
            setActiveId(null);
            setEditingId(null);
          }
        }}
      >
        {overlays.map((o) => {
          const isActive = o.id === activeId;
          const isEditing = o.id === editingId;
          const bgStyle =
            o.bg === "black" ? "rgba(0,0,0,0.75)"
            : o.bg === "white" ? "rgba(255,255,255,0.85)"
            : o.bg === "semi" ? "rgba(0,0,0,0.45)"
            : "transparent";

          return (
            <div
              key={o.id}
              style={{
                ...styles.overlayBlock,
                left: `${o.x}%`,
                top: `${o.y}%`,
                outline: isActive ? "1.5px dashed rgba(96,165,250,0.8)" : "none",
                cursor: isEditing ? "text" : "grab",
              }}
              onMouseDown={(e) => startDrag(e, o.id)}
              onTouchStart={(e) => {
                if (e.touches.length === 2) {
                  startPinch(e, o.id);
                } else {
                  startDrag(e, o.id);
                }
              }}
              onTouchMove={(e) => {
                if (e.touches.length === 2) onMove(e);
              }}
              onWheel={(e) => onWheel(e, o.id)}
              onDoubleClick={() => { setActiveId(o.id); setEditingId(o.id); }}
            >
              {/* Text lines */}
              {o.lines.map((line, li) => (
                <div key={li} style={{ position: "relative", display: "flex", alignItems: "center" }}>
                  {isEditing ? (
                    <textarea
                      autoFocus={li === 0}
                      value={line}
                      rows={1}
                      onChange={(e) => updateLine(o.id, li, e.target.value)}
                      onKeyDown={(e) => handleTextareaKeyDown(e, o.id, li)}
                      style={{
                        ...styles.lineInput,
                        fontSize: o.fontSize,
                        color: o.color,
                        fontFamily: FONT_MAP[o.fontFamily],
                        background: bgStyle,
                        WebkitTextStroke: o.color === "#ffffff" ? "0.5px rgba(0,0,0,0.6)" : "none",
                      }}
                    />
                  ) : (
                    <span
                      style={{
                        ...styles.lineText,
                        fontSize: o.fontSize,
                        color: o.color,
                        fontFamily: FONT_MAP[o.fontFamily],
                        background: bgStyle,
                        WebkitTextStroke: o.color === "#ffffff" ? "0.5px rgba(0,0,0,0.6)" : "none",
                        padding: o.bg !== "none" ? "2px 8px" : "0",
                        borderRadius: o.bg !== "none" ? "4px" : "0",
                      }}
                    >
                      {line || " "}
                    </span>
                  )}

                  {/* Split line button — visible when active, not editing */}
                  {isActive && !isEditing && o.lines.length < 6 && (
                    <button
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); quickSplitLine(o.id, li); }}
                      style={styles.splitBtn}
                      title="Split this line in two"
                    >
                      ↵
                    </button>
                  )}

                  {/* Merge up button — for line 2+ when active */}
                  {isActive && !isEditing && li > 0 && (
                    <button
                      onMouseDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); mergeLineUp(o.id, li); }}
                      style={styles.mergeBtn}
                      title="Merge with line above"
                    >
                      ↑
                    </button>
                  )}
                </div>
              ))}

              {/* Double-tap hint */}
              {isActive && !isEditing && (
                <div style={styles.editHint}>double-tap to edit · Enter to split line</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Toolbar */}
      {toolbar}
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const styles = {
  root: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    fontFamily: "'Helvetica Neue', Arial, sans-serif",
    color: "#fff",
    userSelect: "none",
  },
  topBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: "8px 12px",
    borderBottom: "1px solid rgba(255,255,255,0.1)",
  },
  hint: {
    fontSize: 12,
    color: "rgba(255,255,255,0.5)",
  },
  addBtn: {
    background: "transparent",
    border: "1px solid rgba(255,255,255,0.3)",
    color: "#fff",
    borderRadius: 8,
    padding: "6px 14px",
    cursor: "pointer",
    fontSize: 13,
  },
  canvas: {
    position: "relative",
    width: "100%",
    aspectRatio: "9/16",
    background: "#111",
    overflow: "hidden",
    touchAction: "none",
  },
  overlayBlock: {
    position: "absolute",
    transform: "translate(-50%, -50%)",
    display: "flex",
    flexDirection: "column",
    gap: 2,
    minWidth: 40,
  },
  lineText: {
    display: "block",
    whiteSpace: "nowrap",
    lineHeight: 1.2,
    fontWeight: "bold",
    letterSpacing: "0.01em",
    textShadow: "0 1px 4px rgba(0,0,0,0.5)",
    pointerEvents: "none",
  },
  lineInput: {
    background: "transparent",
    border: "none",
    borderBottom: "1px solid rgba(255,255,255,0.4)",
    outline: "none",
    fontWeight: "bold",
    whiteSpace: "nowrap",
    resize: "none",
    overflow: "hidden",
    lineHeight: 1.2,
    minWidth: 60,
    width: "auto",
    padding: "2px 4px",
  },
  splitBtn: {
    marginLeft: 6,
    background: "rgba(96,165,250,0.2)",
    border: "1px solid rgba(96,165,250,0.5)",
    color: "#60a5fa",
    borderRadius: 4,
    width: 22,
    height: 22,
    fontSize: 12,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    padding: 0,
  },
  mergeBtn: {
    marginLeft: 4,
    background: "rgba(251,191,36,0.2)",
    border: "1px solid rgba(251,191,36,0.5)",
    color: "#fbbf24",
    borderRadius: 4,
    width: 22,
    height: 22,
    fontSize: 12,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    padding: 0,
  },
  editHint: {
    fontSize: 10,
    color: "rgba(255,255,255,0.4)",
    marginTop: 2,
    whiteSpace: "nowrap",
  },
  toolbar: {
    display: "flex",
    flexWrap: "wrap",
    gap: 12,
    padding: "10px 12px",
    borderTop: "1px solid rgba(255,255,255,0.1)",
    alignItems: "center",
    background: "rgba(0,0,0,0.3)",
  },
  toolLabel: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12,
    color: "rgba(255,255,255,0.6)",
  },
  toolValue: {
    fontSize: 11,
    color: "rgba(255,255,255,0.4)",
    minWidth: 36,
  },
  slider: {
    width: 80,
    accentColor: "#60a5fa",
  },
  swatchRow: {
    display: "flex",
    gap: 4,
  },
  swatch: {
    width: 20,
    height: 20,
    borderRadius: "50%",
    border: "1px solid rgba(255,255,255,0.2)",
    cursor: "pointer",
    padding: 0,
  },
  bgBtn: {
    background: "transparent",
    border: "1px solid rgba(255,255,255,0.2)",
    color: "#fff",
    borderRadius: 4,
    padding: "2px 6px",
    fontSize: 13,
    cursor: "pointer",
  },
  select: {
    background: "#222",
    border: "1px solid rgba(255,255,255,0.2)",
    color: "#fff",
    borderRadius: 4,
    padding: "2px 6px",
    fontSize: 12,
  },
  deleteBtn: {
    marginLeft: "auto",
    background: "rgba(239,68,68,0.15)",
    border: "1px solid rgba(239,68,68,0.4)",
    color: "#f87171",
    borderRadius: 6,
    padding: "4px 10px",
    fontSize: 12,
    cursor: "pointer",
  },
};
