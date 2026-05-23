import React, { useState, useEffect } from 'react';
import { api } from '../services/api';

const STYLES = ['casual', 'professional', 'funny', 'motivational', 'minimal', 'educational'];
const BLANK  = { name: '', ig_user_id: '', access_token: '', caption_style: 'casual', caption_prompt: '' };
const BACKEND = (import.meta.env.VITE_BACKEND_URL ?? '').replace(/\/$/, '');

export default function AccountManager() {
  const [accounts, setAccounts] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId]     = useState(null);
  const [form, setForm]         = useState(BLANK);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState('');

  useEffect(() => {
    load();
    const params = new URLSearchParams(window.location.search);
    window.history.replaceState({}, '', window.location.pathname);
    const authSuccess = params.get('auth_success');
    if (authSuccess !== null) { setSuccess(`@${authSuccess} connected!`); load(); }
    if (params.get('auth_error')) setError('Instagram connect failed: ' + params.get('auth_error'));
  }, []);

  async function load() {
    const data = await api.getAccounts().catch(() => []);
    setAccounts(data);
  }

  function openAdd() { setEditId(null); setForm(BLANK); setError(''); setSuccess(''); setShowForm(true); }
  function openEdit(a) {
    setEditId(a.id);
    setForm({ name: a.name, ig_user_id: a.ig_user_id, access_token: '', caption_style: a.caption_style, caption_prompt: a.caption_prompt || '' });
    setError(''); setSuccess(''); setShowForm(true);
  }
  function cancel() { setShowForm(false); setEditId(null); setError(''); }

  async function handleSubmit(e) {
    e.preventDefault(); setError(''); setLoading(true);
    try {
      if (editId) { await api.updateAccount(editId, form); setSuccess('Account updated'); }
      else { const res = await api.addAccount(form); setSuccess(`@${res.username} added`); }
      setShowForm(false); setEditId(null); await load();
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  async function handleDelete(id, name) {
    if (!window.confirm(`Delete "${name}"?`)) return;
    await api.deleteAccount(id).catch(err => setError(err.message));
    await load();
  }

  const set = (k, v) => setForm(prev => ({ ...prev, [k]: v }));

  return (
    <div>
      {/* Header */}
      <div style={s.pageHead}>
        <h1 style={s.pageTitle}>Accounts</h1>
        <span style={s.count}>{accounts.length}</span>
      </div>

      {/* Alerts */}
      {error   && <div style={s.alertErr}>{error}</div>}
      {success && <div style={s.alertOk}>{success}</div>}

      {/* Connect buttons */}
      <div style={s.connectRow}>
        <button onClick={() => window.location.href = `${BACKEND}/auth/instagram`} style={s.connectBtn}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
            <rect x="2" y="2" width="20" height="20" rx="6" fill="url(#ig2)"/>
            <circle cx="12" cy="12" r="4.5" stroke="#fff" strokeWidth="2"/>
            <circle cx="17.5" cy="6.5" r="1.2" fill="#fff"/>
            <defs>
              <linearGradient id="ig2" x1="2" y1="22" x2="22" y2="2">
                <stop offset="0%" stopColor="#f97316"/>
                <stop offset="50%" stopColor="#e6356a"/>
                <stop offset="100%" stopColor="#a855f7"/>
              </linearGradient>
            </defs>
          </svg>
          Connect Instagram
        </button>
        <button onClick={showForm ? cancel : openAdd} style={s.manualBtn}>
          {showForm ? 'Cancel' : '+ Manual'}
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div style={s.formCard}>
          <h3 style={s.formTitle}>{editId ? 'Edit Account' : 'Add Account'}</h3>
          <form onSubmit={handleSubmit}>
            <Field label="Display Name">
              <input style={s.input} value={form.name} onChange={e => set('name', e.target.value)} placeholder="My Instagram" required />
            </Field>
            <Field label="Instagram User ID">
              <input style={s.input} value={form.ig_user_id} onChange={e => set('ig_user_id', e.target.value)} placeholder="123456789" required />
            </Field>
            <Field label={editId ? 'New Access Token (leave blank to keep)' : 'Access Token'}>
              <input style={s.input} value={form.access_token} onChange={e => set('access_token', e.target.value)} placeholder="EAAG..." required={!editId} />
            </Field>
            <Field label="Caption Style">
              <div style={s.styleGrid}>
                {STYLES.map(st => (
                  <button type="button" key={st} onClick={() => set('caption_style', st)}
                    style={{ ...s.stylePill, ...(form.caption_style === st ? s.styleOn : {}) }}>
                    {st}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Custom Caption Instructions (optional)">
              <textarea style={{ ...s.input, minHeight: 70, resize: 'vertical' }} value={form.caption_prompt}
                onChange={e => set('caption_prompt', e.target.value)} placeholder="Always start with a question..." />
            </Field>
            <div style={s.formBtns}>
              <button type="button" onClick={cancel} style={s.cancelBtn}>Cancel</button>
              <button type="submit" disabled={loading} style={s.submitBtn}>
                {loading ? 'Saving…' : editId ? 'Save Changes' : 'Add Account'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Accounts list */}
      {accounts.length === 0 && !showForm && (
        <div style={s.empty}>
          <div style={s.emptyIcon}>◎</div>
          <p style={s.emptyTitle}>No accounts yet</p>
          <p style={s.emptyHint}>Connect your Instagram to get started</p>
        </div>
      )}

      <div style={s.list}>
        {accounts.map(a => (
          <div key={a.id} style={s.card}>
            <div style={s.cardLeft}>
              <div style={s.avatar}>{(a.username || a.name || '?')[0].toUpperCase()}</div>
              <div>
                <div style={s.acctName}>{a.name}</div>
                <div style={s.acctHandle}>@{a.username || a.ig_user_id}</div>
                <div style={{ ...s.stylePillStatic }}>{a.caption_style}</div>
              </div>
            </div>
            <div style={s.cardActions}>
              <button onClick={() => openEdit(a)} style={s.editBtn}>Edit</button>
              <button onClick={() => handleDelete(a.id, a.name)} style={s.deleteBtn}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#666', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 7 }}>{label}</label>
      {children}
    </div>
  );
}

const s = {
  pageHead:     { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 },
  pageTitle:    { fontSize: 26, fontWeight: 700, color: '#fff', margin: 0, letterSpacing: '-0.5px' },
  count:        { background: 'rgba(255,255,255,0.06)', color: '#777', fontSize: 13, fontWeight: 600, borderRadius: 20, padding: '3px 10px' },
  alertErr:     { padding: '12px 16px', background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 10, color: '#f87171', fontSize: 14, marginBottom: 16 },
  alertOk:      { padding: '12px 16px', background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: 10, color: '#34d399', fontSize: 14, marginBottom: 16 },
  connectRow:   { display: 'flex', gap: 10, marginBottom: 24 },
  connectBtn:   { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '14px', background: 'linear-gradient(135deg,#f97316,#e6356a,#a855f7)', border: 'none', borderRadius: 14, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' },
  manualBtn:    { padding: '14px 20px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14, color: '#aaa', fontSize: 14, fontWeight: 600, cursor: 'pointer', flexShrink: 0 },
  formCard:     { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, padding: '20px', marginBottom: 24 },
  formTitle:    { fontSize: 17, fontWeight: 700, color: '#fff', margin: '0 0 20px' },
  input:        { width: '100%', padding: '12px 14px', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 10, color: '#fff', fontSize: 15, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' },
  styleGrid:    { display: 'flex', flexWrap: 'wrap', gap: 8 },
  stylePill:    { padding: '7px 16px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.08)', background: 'transparent', color: '#666', cursor: 'pointer', fontSize: 13, fontWeight: 500, textTransform: 'capitalize' },
  styleOn:      { background: 'rgba(168,85,247,0.15)', borderColor: 'rgba(168,85,247,0.4)', color: '#c084fc' },
  stylePillStatic: { display: 'inline-block', marginTop: 4, padding: '2px 10px', borderRadius: 10, background: 'rgba(168,85,247,0.1)', color: '#a855f7', fontSize: 11, fontWeight: 600, textTransform: 'capitalize' },
  formBtns:     { display: 'flex', gap: 10, marginTop: 20 },
  cancelBtn:    { flex: 1, padding: '13px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', color: '#888', fontSize: 15, fontWeight: 600, cursor: 'pointer' },
  submitBtn:    { flex: 2, padding: '13px', borderRadius: 12, background: 'linear-gradient(135deg,#e6356a,#a855f7)', border: 'none', color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer' },
  empty:        { textAlign: 'center', padding: '70px 20px' },
  emptyIcon:    { fontSize: 52, marginBottom: 16, color: '#333' },
  emptyTitle:   { color: '#fff', fontSize: 17, fontWeight: 600, margin: '0 0 6px' },
  emptyHint:    { color: '#555', fontSize: 14, margin: 0 },
  list:         { display: 'flex', flexDirection: 'column', gap: 10 },
  card:         { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 16, padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  cardLeft:     { display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 },
  avatar:       { width: 46, height: 46, borderRadius: 15, background: 'linear-gradient(135deg,#e6356a,#a855f7)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 20, fontWeight: 700, flexShrink: 0 },
  acctName:     { color: '#fff', fontWeight: 600, fontSize: 15, marginBottom: 2 },
  acctHandle:   { color: '#666', fontSize: 13, marginBottom: 4 },
  cardActions:  { display: 'flex', gap: 8, flexShrink: 0 },
  editBtn:      { padding: '8px 16px', borderRadius: 10, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', color: '#aaa', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  deleteBtn:    { padding: '8px 16px', borderRadius: 10, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.15)', color: '#f87171', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
};
