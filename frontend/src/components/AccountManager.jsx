import React, { useState, useEffect } from 'react';
import { api } from '../services/api';

const STYLES = ['casual', 'professional', 'funny', 'motivational', 'minimal', 'educational'];

const BLANK = { name: '', ig_user_id: '', access_token: '', caption_style: 'casual', caption_prompt: '' };

const BACKEND = (import.meta.env.VITE_BACKEND_URL ?? '').replace(/\/$/, '');

export default function AccountManager() {
  const [accounts, setAccounts] = useState([]);
  const [showForm, setShowForm]   = useState(false);
  const [editId, setEditId]       = useState(null);
  const [form, setForm]           = useState(BLANK);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState('');
  const [success, setSuccess]     = useState('');

  useEffect(() => {
    load();
    // Handle redirect back from Facebook OAuth
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth_success') !== null) {
      const n = params.get('auth_success');
      setSuccess(n > 0 ? `${n} Instagram account(s) connected successfully!` : 'Connected but no Instagram Business accounts found on your Facebook Pages.');
      window.history.replaceState({}, '', window.location.pathname);
    }
    if (params.get('auth_error')) {
      setError('Facebook login failed: ' + params.get('auth_error'));
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  async function load() {
    const data = await api.getAccounts().catch(() => []);
    setAccounts(data);
  }

  function openAdd() {
    setEditId(null); setForm(BLANK); setError(''); setSuccess(''); setShowForm(true);
  }

  function openEdit(a) {
    setEditId(a.id);
    setForm({ name: a.name, ig_user_id: a.ig_user_id, access_token: '', caption_style: a.caption_style, caption_prompt: a.caption_prompt || '' });
    setError(''); setSuccess(''); setShowForm(true);
  }

  function cancel() { setShowForm(false); setEditId(null); setError(''); }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      if (editId) {
        await api.updateAccount(editId, form);
        setSuccess('Account updated');
      } else {
        const res = await api.addAccount(form);
        setSuccess(`Account @${res.username} added and verified`);
      }
      setShowForm(false); setEditId(null);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id, name) {
    if (!window.confirm(`Delete account "${name}"? This cannot be undone.`)) return;
    await api.deleteAccount(id).catch(err => setError(err.message));
    await load();
  }

  const f = form;
  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  return (
    <div>
      <div style={s.hdr}>
        <h2 style={s.h2}>Accounts</h2>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => window.location.href = `${BACKEND}/auth/instagram`} style={s.fbBtn}>
            Connect Instagram
          </button>
          <button onClick={showForm ? cancel : openAdd} style={s.addBtn}>
            {showForm ? 'Cancel' : '+ Manual Add'}
          </button>
        </div>
      </div>

      {error   && <div style={s.errorBox}>{error}</div>}
      {success && <div style={s.successBox}>{success}</div>}

      {showForm && (
        <form onSubmit={handleSubmit} style={s.form}>
          <h3 style={s.h3}>{editId ? 'Edit Account' : 'Add Instagram Account'}</h3>

          <div style={s.grid2}>
            <Field label="Account Label">
              <input required value={f.name} onChange={e => set('name', e.target.value)} placeholder="My Business Page" style={s.input} />
            </Field>
            <Field label="Instagram User ID (optional — needed for auto-posting)">
              <input value={f.ig_user_id} onChange={e => set('ig_user_id', e.target.value)} placeholder="17841XXXXXXXXXX" style={s.input} disabled={!!editId} />
              <div style={s.hint}>Numeric ID from Meta Graph API — only required if you want to auto-post</div>
            </Field>
          </div>

          <Field label={`Access Token (optional — needed for auto-posting)${editId ? ' — leave blank to keep current' : ''}`}>
            <input
              type="password"
              value={f.access_token}
              onChange={e => set('access_token', e.target.value)}
              placeholder="EAAxxxxx… (long-lived page access token)"
              style={s.input}
            />
            <div style={s.hint}>Page Access Token from Meta Graph API — only required if you want to auto-post</div>
          </Field>

          <div style={s.grid2}>
            <Field label="Caption Style">
              <select value={f.caption_style} onChange={e => set('caption_style', e.target.value)} style={s.select}>
                {STYLES.map(st => <option key={st} value={st}>{st.charAt(0).toUpperCase() + st.slice(1)}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Custom Caption Prompt (optional — overrides style)">
            <textarea
              value={f.caption_prompt}
              onChange={e => set('caption_prompt', e.target.value)}
              placeholder="e.g. Write a fitness-focused caption with a call to action. Always include #FitnessMotivation."
              rows={3}
              style={s.textarea}
            />
          </Field>

          <button type="submit" disabled={loading} style={{ ...s.btn, opacity: loading ? 0.5 : 1 }}>
            {loading ? 'Saving…' : editId ? 'Save Changes' : 'Add Account'}
          </button>
        </form>
      )}

      {accounts.length === 0 && !showForm && (
        <div style={s.empty}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>📱</div>
          <div style={{ color: '#555' }}>No accounts yet. Add your first Instagram Business or Creator account.</div>
        </div>
      )}

      <div style={s.list}>
        {accounts.map(a => (
          <div key={a.id} style={s.card}>
            <div style={s.cardLeft}>
              <div style={s.avatar}>@</div>
              <div>
                <div style={s.acctName}>@{a.username}</div>
                <div style={s.acctMeta}>{a.name} &bull; <span style={{ color: '#666' }}>{a.caption_style} style</span></div>
                {a.caption_prompt && <div style={s.acctPrompt}>{a.caption_prompt.substring(0, 80)}…</div>}
              </div>
            </div>
            <div style={s.cardRight}>
              <button onClick={() => openEdit(a)} style={s.editBtn}>Edit</button>
              <button onClick={() => handleDelete(a.id, a.name)} style={s.delBtn}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  );
}

const s = {
  hdr:      { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  h2:       { fontSize: 22, fontWeight: 700, color: '#fff', margin: 0 },
  h3:       { fontSize: 16, fontWeight: 700, color: '#fff', marginBottom: 18 },
  fbBtn:    { padding: '9px 18px', background: '#1877f2', border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  addBtn:   { padding: '9px 18px', background: 'linear-gradient(135deg,#833ab4,#fd1d1d)', border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 13 },
  form:     { background: '#0d0d0d', border: '1px solid #1c1c1c', borderRadius: 12, padding: 24, marginBottom: 24 },
  grid2:    { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 },
  input:    { width: '100%', padding: '9px 11px', background: '#111', border: '1px solid #252525', borderRadius: 7, color: '#fff', fontSize: 13, outline: 'none' },
  select:   { width: '100%', padding: '9px 11px', background: '#111', border: '1px solid #252525', borderRadius: 7, color: '#fff', fontSize: 13, outline: 'none', cursor: 'pointer' },
  textarea: { width: '100%', padding: '9px 11px', background: '#111', border: '1px solid #252525', borderRadius: 7, color: '#fff', fontSize: 13, resize: 'vertical', fontFamily: 'inherit', outline: 'none' },
  hint:     { fontSize: 11, color: '#444', marginTop: 4 },
  btn:      { padding: '11px 22px', background: 'linear-gradient(135deg,#833ab4,#fd1d1d)', border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 14 },
  errorBox: { background: '#1e0d0d', border: '1px solid #4a1a1a', borderRadius: 8, padding: '10px 14px', color: '#ff7070', fontSize: 13, marginBottom: 16 },
  successBox:{ background: '#0d1e0d', border: '1px solid #1a4a1a', borderRadius: 8, padding: '10px 14px', color: '#70ff70', fontSize: 13, marginBottom: 16 },
  empty:    { textAlign: 'center', padding: '60px 0' },
  list:     { display: 'flex', flexDirection: 'column', gap: 10 },
  card:     { background: '#0d0d0d', border: '1px solid #1c1c1c', borderRadius: 10, padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  cardLeft: { display: 'flex', alignItems: 'center', gap: 14 },
  avatar:   { width: 36, height: 36, background: 'linear-gradient(135deg,#833ab4,#fd1d1d)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 14, flexShrink: 0 },
  acctName: { fontWeight: 600, color: '#fff', fontSize: 14 },
  acctMeta: { fontSize: 12, color: '#888', marginTop: 2 },
  acctPrompt: { fontSize: 11, color: '#555', marginTop: 3, maxWidth: 400 },
  cardRight:{ display: 'flex', gap: 8 },
  editBtn:  { padding: '7px 14px', background: '#181818', border: '1px solid #2a2a2a', borderRadius: 6, color: '#aaa', cursor: 'pointer', fontSize: 12 },
  delBtn:   { padding: '7px 14px', background: '#1a0d0d', border: '1px solid #3a1a1a', borderRadius: 6, color: '#ff7070', cursor: 'pointer', fontSize: 12 },
};
