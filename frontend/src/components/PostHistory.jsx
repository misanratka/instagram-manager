import React, { useState, useEffect } from 'react';
import { api } from '../services/api';

const STATUS_COLOR = {
  draft:     '#555',
  scheduled: '#fcb045',
  posted:    '#52c41a',
  failed:    '#ff7070',
};

const ALL_STATUSES = ['all', 'draft', 'scheduled', 'posted', 'failed'];

export default function PostHistory() {
  const [posts, setPosts]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState('all');

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const data = await api.getPosts().catch(() => []);
    setPosts(data);
    setLoading(false);
  }

  async function handleDelete(id) {
    if (!window.confirm('Delete this post record?')) return;
    await api.deletePost(id).catch(() => {});
    await load();
  }

  const visible = filter === 'all' ? posts : posts.filter(p => p.status === filter);

  return (
    <div>
      <div style={s.hdr}>
        <h2 style={s.h2}>Posts</h2>
        <div style={s.filters}>
          {ALL_STATUSES.map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{ ...s.filterBtn, ...(filter === f ? s.filterActive : {}) }}
            >
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {loading && <div style={s.center}>Loading…</div>}

      {!loading && visible.length === 0 && (
        <div style={s.empty}>
          <div style={{ fontSize: 36, marginBottom: 10 }}>📋</div>
          <div style={{ color: '#555' }}>No {filter !== 'all' ? filter : ''} posts yet.</div>
        </div>
      )}

      <div style={s.list}>
        {visible.map(post => {
          const caption = post.final_caption || post.generated_caption || '';
          return (
            <div key={post.id} style={s.card}>
              <div style={s.cardBody}>
                <div style={s.meta}>
                  <span style={{ ...s.status, color: STATUS_COLOR[post.status] || '#555' }}>
                    ● {post.status}
                  </span>
                  {post.username && (
                    <span style={s.acct}>@{post.username}</span>
                  )}
                  <span style={s.date}>{new Date(post.created_at).toLocaleDateString()}</span>
                  {post.ig_media_id && (
                    <span style={s.mediaId}>ID: {post.ig_media_id}</span>
                  )}
                </div>

                {caption && (
                  <div style={s.caption}>
                    {caption.length > 140 ? caption.substring(0, 140) + '…' : caption}
                  </div>
                )}

                {post.hook_text && (
                  <div style={s.hook}>Hook: "{post.hook_text}"</div>
                )}

                {post.scheduled_at && post.status === 'scheduled' && (
                  <div style={s.scheduled}>
                    Scheduled: {new Date(post.scheduled_at).toLocaleString()}
                  </div>
                )}

                {post.posted_at && (
                  <div style={s.postedAt}>
                    Posted: {new Date(post.posted_at).toLocaleString()}
                  </div>
                )}

                {post.error_message && (
                  <div style={s.errorMsg}>{post.error_message}</div>
                )}
              </div>

              <button onClick={() => handleDelete(post.id)} style={s.delBtn}>Delete</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const s = {
  hdr:        { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 10 },
  h2:         { fontSize: 22, fontWeight: 700, color: '#fff', margin: 0 },
  filters:    { display: 'flex', gap: 6, flexWrap: 'wrap' },
  filterBtn:  { padding: '5px 12px', background: 'transparent', border: '1px solid #222', borderRadius: 6, color: '#555', cursor: 'pointer', fontSize: 12 },
  filterActive:{ background: '#1a1a1a', borderColor: '#444', color: '#fff' },
  center:     { textAlign: 'center', padding: '40px 0', color: '#555' },
  empty:      { textAlign: 'center', padding: '60px 0' },
  list:       { display: 'flex', flexDirection: 'column', gap: 8 },
  card:       { background: '#0d0d0d', border: '1px solid #1c1c1c', borderRadius: 10, padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 },
  cardBody:   { flex: 1, minWidth: 0 },
  meta:       { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 },
  status:     { fontSize: 12, fontWeight: 700, textTransform: 'capitalize' },
  acct:       { fontSize: 12, color: '#888' },
  date:       { fontSize: 11, color: '#444' },
  mediaId:    { fontSize: 11, color: '#333', fontFamily: 'monospace' },
  caption:    { fontSize: 13, color: '#aaa', lineHeight: 1.5, marginBottom: 4 },
  hook:       { fontSize: 11, color: '#666', fontStyle: 'italic', marginBottom: 4 },
  scheduled:  { fontSize: 12, color: '#fcb045', marginTop: 4 },
  postedAt:   { fontSize: 12, color: '#52c41a', marginTop: 4 },
  errorMsg:   { fontSize: 12, color: '#ff7070', marginTop: 4, background: '#1a0808', padding: '4px 8px', borderRadius: 4 },
  delBtn:     { padding: '7px 14px', background: '#1a0d0d', border: '1px solid #3a1a1a', borderRadius: 6, color: '#ff7070', cursor: 'pointer', fontSize: 12, flexShrink: 0 },
};
