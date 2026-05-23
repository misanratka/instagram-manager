import React, { useState, useEffect } from 'react';
import { api } from '../services/api';

const STATUS = {
  draft:      { color: '#6B7280', bg: 'rgba(107,114,128,0.1)', label: 'Draft' },
  publishing: { color: '#a855f7', bg: 'rgba(168,85,247,0.1)', label: 'Publishing' },
  scheduled:  { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', label: 'Scheduled' },
  posted:     { color: '#10b981', bg: 'rgba(16,185,129,0.1)', label: 'Posted' },
  failed:     { color: '#ef4444', bg: 'rgba(239,68,68,0.1)', label: 'Failed' },
};

const FILTERS = ['all', 'draft', 'publishing', 'scheduled', 'posted', 'failed'];

export default function PostHistory() {
  const [posts, setPosts]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState('all');

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const hasPublishing = posts.some(p => p.status === 'publishing');
    if (!hasPublishing) return;
    const t = setTimeout(load, 5000);
    return () => clearTimeout(t);
  }, [posts]);

  async function load() {
    setLoading(true);
    const data = await api.getPosts().catch(() => []);
    setPosts(data);
    setLoading(false);
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this post?')) return;
    await api.deletePost(id).catch(() => {});
    await load();
  }

  const visible = filter === 'all' ? posts : posts.filter(p => p.status === filter);

  return (
    <div>
      {/* Page title */}
      <div style={s.pageHead}>
        <h1 style={s.pageTitle}>Your Posts</h1>
        <span style={s.count}>{posts.length}</span>
      </div>

      {/* Filter pills */}
      <div style={s.filters}>
        {FILTERS.map(f => (
          <button key={f} onClick={() => setFilter(f)}
            style={{ ...s.pill, ...(filter === f ? s.pillOn : {}) }}>
            {f === 'all' ? 'All' : STATUS[f]?.label ?? f}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div style={s.center}>
          <div style={s.spinner} />
          <span style={{ color: '#555', fontSize: 13 }}>Loading posts…</span>
        </div>
      )}

      {/* Empty */}
      {!loading && visible.length === 0 && (
        <div style={s.empty}>
          <div style={s.emptyIcon}>📋</div>
          <p style={s.emptyText}>No {filter !== 'all' ? filter : ''} posts yet</p>
          <p style={s.emptyHint}>Create your first post from the Create tab</p>
        </div>
      )}

      {/* Post cards */}
      <div style={s.list}>
        {visible.map(post => {
          const st = STATUS[post.status] ?? STATUS.draft;
          const caption = post.final_caption || post.generated_caption || '';
          return (
            <div key={post.id} style={s.card}>
              {/* Status bar */}
              <div style={s.cardTop}>
                <span style={{ ...s.statusBadge, color: st.color, background: st.bg }}>
                  {post.status === 'publishing' ? '⟳ ' : '● '}{st.label}
                </span>
                {post.username && <span style={s.handle}>@{post.username}</span>}
                <span style={s.date}>{new Date(post.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                <button onClick={() => handleDelete(post.id)} style={s.delBtn}>✕</button>
              </div>

              {/* Caption */}
              {caption && (
                <p style={s.caption}>
                  {caption.length > 160 ? caption.slice(0, 160) + '…' : caption}
                </p>
              )}

              {/* Hook */}
              {post.hook_text && (
                <div style={s.hookRow}>
                  <span style={s.hookLabel}>Hook</span>
                  <span style={s.hookText}>"{post.hook_text}"</span>
                </div>
              )}

              {/* Scheduled */}
              {post.scheduled_at && post.status === 'scheduled' && (
                <div style={{ ...s.metaRow, color: '#f59e0b' }}>
                  🕐 {new Date(post.scheduled_at).toLocaleString()}
                </div>
              )}

              {/* Posted */}
              {post.posted_at && (
                <div style={{ ...s.metaRow, color: '#10b981' }}>
                  ✓ Posted {new Date(post.posted_at).toLocaleString()}
                </div>
              )}

              {/* Error */}
              {post.error_message && (
                <div style={s.errBox}>{post.error_message}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const s = {
  pageHead:    { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 },
  pageTitle:   { fontSize: 26, fontWeight: 700, color: '#fff', margin: 0, letterSpacing: '-0.5px' },
  count:       { background: 'rgba(255,255,255,0.06)', color: '#777', fontSize: 13, fontWeight: 600, borderRadius: 20, padding: '3px 10px' },
  filters:     { display: 'flex', gap: 8, marginBottom: 24, overflowX: 'auto', paddingBottom: 4 },
  pill:        { padding: '7px 16px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: '#666', cursor: 'pointer', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', flexShrink: 0 },
  pillOn:      { background: 'rgba(168,85,247,0.15)', borderColor: 'rgba(168,85,247,0.4)', color: '#c084fc' },
  center:      { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '60px 0' },
  spinner:     { width: 28, height: 28, border: '2px solid rgba(255,255,255,0.08)', borderTop: '2px solid #a855f7', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
  empty:       { textAlign: 'center', padding: '70px 20px' },
  emptyIcon:   { fontSize: 48, marginBottom: 16 },
  emptyText:   { color: '#fff', fontSize: 17, fontWeight: 600, margin: '0 0 6px' },
  emptyHint:   { color: '#555', fontSize: 14, margin: 0 },
  list:        { display: 'flex', flexDirection: 'column', gap: 12 },
  card:        { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, padding: '16px', backdropFilter: 'blur(10px)' },
  cardTop:     { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' },
  statusBadge: { fontSize: 11, fontWeight: 700, borderRadius: 20, padding: '4px 10px' },
  handle:      { fontSize: 12, color: '#777', fontWeight: 500 },
  date:        { fontSize: 11, color: '#444', marginLeft: 'auto' },
  delBtn:      { background: 'transparent', border: 'none', color: '#444', cursor: 'pointer', fontSize: 16, padding: '2px 6px', lineHeight: 1, borderRadius: 6, ':hover': { color: '#ef4444' } },
  caption:     { fontSize: 14, color: '#aaa', lineHeight: 1.6, margin: '0 0 8px' },
  hookRow:     { display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 6 },
  hookLabel:   { fontSize: 10, fontWeight: 700, color: '#a855f7', background: 'rgba(168,85,247,0.1)', padding: '2px 7px', borderRadius: 10, flexShrink: 0 },
  hookText:    { fontSize: 13, color: '#888', fontStyle: 'italic' },
  metaRow:     { fontSize: 12, marginTop: 6 },
  errBox:      { marginTop: 8, padding: '8px 12px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 8, color: '#f87171', fontSize: 12 },
};
