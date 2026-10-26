import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../services/api';

const DETECTED_TZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { return 'UTC'; } })();
const TZ_LIST = [...new Set(['Asia/Dhaka', 'Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'UTC', DETECTED_TZ])];
const hourLabel = (h) => `${String(h % 24).padStart(2, '0')}:00`;

function fmtTime(iso, tz) {
  if (!iso) return null;
  try { return new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit', timeZone: tz || undefined }).format(new Date(iso)); } catch { return null; }
}
const shortUrl = (u) => String(u).replace(/^https?:\/\/(www\.)?/, '').slice(0, 48);

export default function Autopilot() {
  const [pages, setPages] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showHelp, setShowHelp] = useState(false);

  const load = useCallback(async () => {
    try { const r = await api.autopilot(); setPages(r.pages); setBusy(r.busy); setError(''); }
    catch (e) { setError(e.message); }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load]);

  if (!pages) return <div style={{ padding: 20, color: '#666' }}>{error || 'Loading…'}</div>;

  return (
    <div style={{ padding: '16px 16px 100px', maxWidth: 560, margin: '0 auto' }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: '#fff', marginBottom: 4 }}>Autopilot</div>
      <div style={{ fontSize: 13, color: '#666', marginBottom: 16 }}>
        Add links to a page's queue. It posts them by itself, on the schedule you set.
        {busy && <span style={{ color: '#c084fc' }}> · A post is being made right now.</span>}
      </div>

      {error && <div style={st.error}>{error}</div>}
      {pages.length === 0 && <div style={{ color: '#666' }}>No pages yet. Connect one in Accounts.</div>}
      {pages.map(p => <PageCard key={p.id} page={p} onChange={load} />)}

      <button type="button" onClick={() => setShowHelp(v => !v)} style={st.helpBtn}>{showHelp ? '▲ Hide' : '▼ Keep it running on the free server'}</button>
      {showHelp && (
        <div style={{ fontSize: 12, color: '#888', lineHeight: 1.7, marginTop: 10 }}>
          The free Render server sleeps when nobody visits it, and a sleeping server can't post. A free pinger fixes that:
          <ol style={{ paddingLeft: 18, margin: '8px 0' }}>
            <li>On Render → Environment, add <b>AUTOPILOT_KEY</b> with any long secret text.</li>
            <li>Create a free job at cron-job.org (or UptimeRobot) that opens this address every 10 minutes:</li>
          </ol>
          <code style={{ display: 'block', background: '#111', padding: 10, borderRadius: 8, color: '#c084fc', wordBreak: 'break-all' }}>
            {window.location.origin}/api/autopilot/tick?key=YOUR_AUTOPILOT_KEY
          </code>
          <div style={{ marginTop: 8 }}>It posts one clip at a time, only when a page's time slot is due.</div>
        </div>
      )}
    </div>
  );
}

function PageCard({ page, onChange }) {
  const [open, setOpen] = useState(false);        // settings
  const [showQ, setShowQ] = useState(false);      // queue list
  const [items, setItems] = useState([]);
  const [links, setLinks] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [working, setWorking] = useState(false);
  const [form, setForm] = useState({ ...page.settings, tz: page.settings.tz || DETECTED_TZ });

  const loadItems = useCallback(async () => {
    try { setItems(await api.autopilotQueue(page.id)); } catch { /* ignore */ }
  }, [page.id]);
  useEffect(() => { if (showQ) loadItems(); }, [showQ, loadItems, page.queue.queued, page.queue.posted, page.queue.failed]);

  const run = async (fn, okMsg) => {
    setWorking(true); setErr(''); setMsg('');
    try { const r = await fn(); if (okMsg) setMsg(okMsg(r)); await onChange(); if (showQ) await loadItems(); }
    catch (e) { setErr(e.message); }
    finally { setWorking(false); }
  };

  const toggle = () => run(() => api.autopilotSettings(page.id, { enabled: !page.enabled, ...(page.settings.tz ? {} : { tz: form.tz }) }));
  const save = () => run(() => api.autopilotSettings(page.id, { per_day: Number(form.per_day), start_hour: Number(form.start_hour), end_hour: Number(form.end_hour), tz: form.tz, layout: form.layout, credit_line: !!form.credit_line }), () => 'Saved');
  const add = () => run(async () => {
    const urls = links.split(/\s+/).map(x => x.trim()).filter(Boolean);
    const r = await api.autopilotAdd(page.id, urls, { layout: form.layout });
    setLinks(''); return r;
  }, r => [`Added ${r.added}`, r.duplicates.length && `${r.duplicates.length} already in the queue`, r.invalid.length && `${r.invalid.length} not a link`, r.overflow.length && `${r.overflow.length} over the limit`].filter(Boolean).join(' · '));

  const next = fmtTime(page.today.next_slot, page.today.tz);
  const status = page.paused ? 'paused' : page.enabled ? 'on' : 'off';

  return (
    <div style={st.card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{page.name}</div>
          <div style={{ fontSize: 12, color: '#666' }}>@{page.username}</div>
        </div>
        <button type="button" role="switch" aria-checked={page.enabled} aria-label={`Autopilot for ${page.name}`} onClick={toggle} disabled={working}
          style={{ ...st.switch, background: page.enabled ? '#7b6fff' : '#2a2a2a' }}>
          <span style={{ ...st.knob, left: page.enabled ? 24 : 2 }} />
        </button>
      </div>

      {page.paused && (
        <div style={{ ...st.warn, marginTop: 12 }}>
          {page.paused}
          <button type="button" onClick={() => run(() => api.autopilotResume(page.id))} disabled={working} style={{ ...st.mini, marginTop: 8, display: 'block' }}>Resume</button>
        </div>
      )}

      <div style={{ fontSize: 13, color: '#999', marginTop: 12, lineHeight: 1.6 }}>
        {status === 'off' && 'Off. Switch it on to start posting.'}
        {status !== 'off' && !page.paused && <>
          Today <b style={{ color: '#fff' }}>{page.today.posted}/{page.today.target}</b>
          {next ? <> · next around <b style={{ color: '#fff' }}>{next}</b></> : ' · done for today'}
        </>}
        <> · Queue <b style={{ color: page.queue.queued ? '#fff' : '#f0a060' }}>{page.queue.queued}</b>{page.enabled && page.queue.queued === 0 && ' (empty, add links)'}</>
        {page.queue.failed > 0 && <> · <span style={{ color: '#ff7070' }}>{page.queue.failed} failed</span></>}
      </div>

      {/* add links */}
      <textarea value={links} onChange={e => setLinks(e.target.value)} rows={3} id={`ap-links-${page.id}`} name="links"
        placeholder={'Paste links, one per line'} style={{ ...st.input, marginTop: 12, resize: 'vertical' }} />
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button type="button" onClick={add} disabled={working || !links.trim()} style={{ ...st.primary, opacity: working || !links.trim() ? 0.4 : 1 }}>Add to queue</button>
        <button type="button" onClick={() => run(() => api.autopilotRun(page.id), r => r.message)} disabled={working || page.queue.queued === 0} style={{ ...st.ghost, opacity: page.queue.queued === 0 ? 0.4 : 1 }}>Post next now</button>
      </div>
      {msg && <div style={{ fontSize: 12, color: '#7bd88f', marginTop: 8 }}>{msg}</div>}
      {err && <div style={{ fontSize: 12, color: '#ff7070', marginTop: 8 }}>{err}</div>}

      <div style={{ display: 'flex', gap: 14, marginTop: 14 }}>
        <button type="button" onClick={() => setShowQ(v => !v)} style={st.link}>{showQ ? '▲ Queue' : '▼ Queue'}</button>
        <button type="button" onClick={() => setOpen(v => !v)} style={st.link}>{open ? '▲ Settings' : '▼ Settings'}</button>
      </div>

      {showQ && (
        <div style={{ marginTop: 10 }}>
          {items.length === 0 && <div style={{ fontSize: 12, color: '#555' }}>Nothing here yet.</div>}
          {items.map(it => (
            <div key={it.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '8px 0', borderTop: '1px solid #181818' }}>
              <span style={{ ...st.chip, ...CHIP[it.status] }}>{it.status}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, color: '#bbb', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortUrl(it.url)}</div>
                {it.error && it.status !== 'posted' && <div style={{ fontSize: 11, color: '#c97', marginTop: 2 }}>{String(it.error).slice(0, 140)}</div>}
              </div>
              {it.status === 'failed' && <button type="button" aria-label="Try again" onClick={() => run(() => api.autopilotRetry(it.id))} style={st.mini}>↻</button>}
              {it.status !== 'processing' && <button type="button" aria-label="Remove" onClick={() => run(() => api.autopilotRemove(it.id))} style={st.mini}>✕</button>}
            </div>
          ))}
        </div>
      )}

      {open && (
        <div style={{ marginTop: 12, borderTop: '1px solid #181818', paddingTop: 12 }}>
          <Row label="Posts per day">
            <select value={form.per_day} onChange={e => setForm({ ...form, per_day: e.target.value })} style={st.select}>
              {[1, 2, 3, 4, 5, 6, 7, 8].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </Row>
          <Row label="Between">
            <select value={form.start_hour} onChange={e => setForm({ ...form, start_hour: e.target.value })} style={st.select}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
            </select>
            <span style={{ color: '#555' }}>and</span>
            <select value={form.end_hour} onChange={e => setForm({ ...form, end_hour: e.target.value })} style={st.select}>
              {Array.from({ length: 24 }, (_, h) => h + 1).map(h => <option key={h} value={h}>{hourLabel(h)}</option>)}
            </select>
          </Row>
          <Row label="Time zone">
            <select value={form.tz} onChange={e => setForm({ ...form, tz: e.target.value })} style={{ ...st.select, flex: 1 }}>
              {TZ_LIST.map(z => <option key={z} value={z}>{z}</option>)}
            </select>
          </Row>
          <Row label="Layout">
            {[['card', 'Page card'], ['text', 'Text only']].map(([k, label]) => (
              <button key={k} type="button" onClick={() => setForm({ ...form, layout: k })}
                style={{ ...st.seg, ...(form.layout === k ? st.segOn : {}) }}>{label}</button>
            ))}
          </Row>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#bbb', margin: '12px 0', cursor: 'pointer' }}>
            <input type="checkbox" checked={!!form.credit_line} onChange={e => setForm({ ...form, credit_line: e.target.checked })} style={{ accentColor: '#7b6fff', width: 16, height: 16 }} />
            Add "Credits — DM for removal." to captions
          </label>
          <button type="button" onClick={save} disabled={working} style={st.primary}>Save settings</button>
          <div style={{ fontSize: 11, color: '#555', marginTop: 8 }}>
            Posts are spread evenly between the two times, a few minutes off each day so they don't look robotic. Captions use this page's saved style, and the on-screen text and card are made automatically.
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
      <div style={{ width: 96, fontSize: 12, color: '#777', flexShrink: 0 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1 }}>{children}</div>
    </div>
  );
}

const CHIP = {
  queued:     { background: '#1a1a1a', color: '#999' },
  processing: { background: 'rgba(123,111,255,0.15)', color: '#a79dff' },
  posted:     { background: 'rgba(80,200,120,0.15)', color: '#7bd88f' },
  failed:     { background: 'rgba(255,90,90,0.15)', color: '#ff7070' },
};

const st = {
  card:    { background: '#0e0e0e', border: '1px solid #1c1c1c', borderRadius: 14, padding: 16, marginBottom: 14 },
  input:   { width: '100%', padding: '10px 12px', background: '#111', border: '1px solid #252525', borderRadius: 8, color: '#fff', fontSize: 14, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' },
  select:  { padding: '9px 10px', background: '#111', border: '1px solid #252525', borderRadius: 8, color: '#fff', fontSize: 13 },
  primary: { flex: 1, padding: '11px 14px', background: '#7b6fff', border: 'none', borderRadius: 10, color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' },
  ghost:   { flex: 1, padding: '11px 14px', background: '#111', border: '1px solid #2a2a2a', borderRadius: 10, color: '#ccc', fontWeight: 600, fontSize: 14, cursor: 'pointer' },
  mini:    { padding: '4px 10px', background: '#151515', border: '1px solid #2a2a2a', borderRadius: 6, color: '#bbb', fontSize: 12, cursor: 'pointer' },
  link:    { background: 'transparent', border: 'none', color: '#8a8a8a', fontSize: 12, cursor: 'pointer', padding: 0 },
  chip:    { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px', padding: '3px 8px', borderRadius: 999, flexShrink: 0, marginTop: 1 },
  seg:     { flex: 1, padding: '9px 10px', background: '#111', border: '1px solid #2a2a2a', borderRadius: 8, color: '#999', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  segOn:   { background: 'rgba(168,85,247,0.15)', borderColor: 'rgba(168,85,247,0.5)', color: '#c084fc' },
  switch:  { position: 'relative', width: 50, height: 28, borderRadius: 999, border: 'none', cursor: 'pointer', flexShrink: 0, transition: 'background .15s' },
  knob:    { position: 'absolute', top: 2, width: 24, height: 24, borderRadius: '50%', background: '#fff', transition: 'left .15s' },
  warn:    { background: 'rgba(240,160,96,0.1)', border: '1px solid rgba(240,160,96,0.3)', borderRadius: 10, padding: 12, fontSize: 12, color: '#f0a060', lineHeight: 1.5 },
  error:   { background: 'rgba(255,90,90,0.1)', border: '1px solid rgba(255,90,90,0.3)', borderRadius: 10, padding: 12, fontSize: 13, color: '#ff7070', marginBottom: 12 },
  helpBtn: { width: '100%', padding: '10px 14px', marginTop: 6, background: 'transparent', border: '1px dashed #2a2a2a', borderRadius: 10, color: '#666', fontSize: 12, cursor: 'pointer' },
};
