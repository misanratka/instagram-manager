import React, { useState, useEffect } from 'react';
import NewPost from './components/NewPost';
import PostHistory from './components/PostHistory';
import AccountManager from './components/AccountManager';

const TABS = [
  { id: 'new', label: 'Create', icon: (active) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="9" stroke={active ? '#fff' : '#555'} strokeWidth="2"/>
      <path d="M12 8v8M8 12h8" stroke={active ? '#fff' : '#555'} strokeWidth="2" strokeLinecap="round"/>
    </svg>
  )},
  { id: 'history', label: 'Posts', icon: (active) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="3" width="7" height="7" rx="2" stroke={active ? '#fff' : '#555'} strokeWidth="2"/>
      <rect x="14" y="3" width="7" height="7" rx="2" stroke={active ? '#fff' : '#555'} strokeWidth="2"/>
      <rect x="3" y="14" width="7" height="7" rx="2" stroke={active ? '#fff' : '#555'} strokeWidth="2"/>
      <rect x="14" y="14" width="7" height="7" rx="2" stroke={active ? '#fff' : '#555'} strokeWidth="2"/>
    </svg>
  )},
  { id: 'accounts', label: 'Accounts', icon: (active) => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8" r="4" stroke={active ? '#fff' : '#555'} strokeWidth="2"/>
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke={active ? '#fff' : '#555'} strokeWidth="2" strokeLinecap="round"/>
    </svg>
  )},
];

function getUser() {
  try {
    // Check URL for token first (coming from auth app)
    const params = new URLSearchParams(window.location.search);
    const token = params.get('user_token');
    if (token) {
      const payload = JSON.parse(atob(token.split('.')[1]));
      const user = { id: payload.id, name: payload.name, email: payload.email };
      localStorage.setItem('im_user', JSON.stringify(user));
      window.history.replaceState({}, '', window.location.pathname);
      return user;
    }
    const u = localStorage.getItem('im_user');
    return u ? JSON.parse(u) : null;
  } catch { return null; }
}

const AUTH_URL = 'https://instamanager-auth.onrender.com';

export default function App() {
  const [tab, setTab] = useState('new');
  const [user, setUser] = useState(null);
  const [showMenu, setShowMenu] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const u = getUser();
    if (!u) {
      // Not logged in — redirect to auth
      window.location.href = AUTH_URL;
    } else {
      setUser(u);
      setChecking(false);
    }
  }, []);

  function handleLogout() {
    localStorage.removeItem('im_user');
    window.location.href = AUTH_URL;
  }

  if (checking) {
    return (
      <div style={{ minHeight: '100dvh', background: '#080A0F', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 32, height: 32, border: '2px solid rgba(255,255,255,0.1)', borderTop: '2px solid #E1306C', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={s.root}>
      {/* Header */}
      <header style={s.header}>
        <div style={s.logo}>
          <div style={s.logoMark}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
              <rect x="2" y="2" width="20" height="20" rx="6" fill="url(#g1)"/>
              <circle cx="12" cy="12" r="4.5" stroke="#fff" strokeWidth="2"/>
              <circle cx="17.5" cy="6.5" r="1.2" fill="#fff"/>
              <defs>
                <linearGradient id="g1" x1="2" y1="22" x2="22" y2="2">
                  <stop offset="0%" stopColor="#f97316"/>
                  <stop offset="50%" stopColor="#e6356a"/>
                  <stop offset="100%" stopColor="#a855f7"/>
                </linearGradient>
              </defs>
            </svg>
          </div>
          <span style={s.logoText}>InstaManager</span>
        </div>

        {/* User menu */}
        <div style={{ position: 'relative' }}>
          <button onClick={() => setShowMenu(!showMenu)} style={s.avatarBtn} title={user?.name}>
            <div style={s.avatar}>
              {user?.name?.charAt(0).toUpperCase() || '?'}
            </div>
          </button>

          {showMenu && (
            <div style={s.menu}>
              <div style={s.menuUser}>
                <div style={s.menuName}>{user?.name}</div>
                <div style={s.menuEmail}>{user?.email}</div>
              </div>
              <div style={s.menuDivider} />
              <button onClick={handleLogout} style={s.menuLogout}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9"/>
                </svg>
                Sign Out
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Overlay to close menu */}
      {showMenu && <div onClick={() => setShowMenu(false)} style={s.overlay} />}

      {/* Main content */}
      <main style={s.main}>
        {tab === 'new'      && <NewPost />}
        {tab === 'history'  && <PostHistory />}
        {tab === 'accounts' && <AccountManager />}
      </main>

      {/* Bottom nav */}
      <nav style={s.nav}>
        {TABS.map(t => {
          const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} style={s.navBtn}>
              <div style={{ ...s.navIcon, background: active ? 'linear-gradient(135deg,#e6356a,#a855f7)' : 'transparent', borderRadius: 14 }}>
                {t.icon(active)}
              </div>
              <span style={{ ...s.navLabel, color: active ? '#fff' : '#555' }}>{t.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

const s = {
  root:       { minHeight: '100dvh', background: '#080A0F', display: 'flex', flexDirection: 'column', fontFamily: '-apple-system,BlinkMacSystemFont,"SF Pro Display",sans-serif', paddingBottom: 80, overflowX: 'hidden', width: '100%', maxWidth: '100vw' },
  header:     { height: 56, padding: '0 20px', background: 'rgba(8,10,15,0.9)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 100 },
  logo:       { display: 'flex', alignItems: 'center', gap: 10 },
  logoMark:   { width: 34, height: 34, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,0.05)' },
  logoText:   { fontWeight: 700, fontSize: 17, color: '#fff', letterSpacing: '-0.3px' },
  avatarBtn:  { background: 'none', border: 'none', cursor: 'pointer', padding: 0 },
  avatar:     { width: 34, height: 34, borderRadius: '50%', background: 'linear-gradient(135deg,#e6356a,#a855f7)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 14 },
  menu:       { position: 'absolute', right: 0, top: 44, background: '#141820', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, minWidth: 200, zIndex: 200, overflow: 'hidden', boxShadow: '0 8px 32px rgba(0,0,0,0.5)' },
  menuUser:   { padding: '14px 16px' },
  menuName:   { color: '#fff', fontWeight: 600, fontSize: 14 },
  menuEmail:  { color: '#6B7280', fontSize: 12, marginTop: 2 },
  menuDivider:{ height: 1, background: 'rgba(255,255,255,0.06)' },
  menuLogout: { width: '100%', padding: '12px 16px', background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 500 },
  overlay:    { position: 'fixed', inset: 0, zIndex: 150 },
  main:       { flex: 1, maxWidth: 600, margin: '0 auto', width: '100%', padding: '16px 16px 16px', overflowX: 'hidden' },
  nav:        { position: 'fixed', bottom: 0, left: 0, right: 0, height: 72, background: 'rgba(8,10,15,0.95)', backdropFilter: 'blur(30px)', borderTop: '1px solid rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'space-around', zIndex: 100, paddingBottom: 'env(safe-area-inset-bottom,0px)' },
  navBtn:     { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5, background: 'none', border: 'none', cursor: 'pointer', padding: '8px 0' },
  navIcon:    { width: 44, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.2s' },
  navLabel:   { fontSize: 10, fontWeight: 600, letterSpacing: '0.3px', transition: 'color 0.2s', textTransform: 'uppercase' },
};
