import React, { useState } from 'react';
import NewPost from './components/NewPost';
import PostHistory from './components/PostHistory';
import AccountManager from './components/AccountManager';

const TABS = [
  { id: 'new',      label: '+ New Post' },
  { id: 'history',  label: 'Posts' },
  { id: 'accounts', label: 'Accounts' },
];

export default function App() {
  const [tab, setTab] = useState('new');

  return (
    <div style={s.wrap}>
      <header style={s.header}>
        <div style={s.logo}>
          <div style={s.logoIcon}>▶</div>
          <span style={s.logoText}>InstaManager</span>
        </div>
        <nav style={s.nav}>
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{ ...s.navBtn, ...(tab === t.id ? s.navActive : {}) }}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main style={s.main}>
        {tab === 'new'      && <NewPost />}
        {tab === 'history'  && <PostHistory />}
        {tab === 'accounts' && <AccountManager />}
      </main>
    </div>
  );
}

const s = {
  wrap:      { minHeight: '100vh', background: '#080808' },
  header:    { height: 56, padding: '0 24px', borderBottom: '1px solid #1c1c1c', display: 'flex', alignItems: 'center', gap: 24, position: 'sticky', top: 0, background: '#080808', zIndex: 50 },
  logo:      { display: 'flex', alignItems: 'center', gap: 8 },
  logoIcon:  { width: 30, height: 30, background: 'linear-gradient(135deg,#833ab4,#fd1d1d,#fcb045)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, flexShrink: 0 },
  logoText:  { fontWeight: 700, fontSize: 16, color: '#fff' },
  nav:       { display: 'flex', gap: 4, marginLeft: 'auto' },
  navBtn:    { padding: '6px 14px', background: 'transparent', border: 'none', borderRadius: 7, color: '#555', cursor: 'pointer', fontSize: 14, fontWeight: 500, transition: 'all .15s' },
  navActive: { background: '#1a1a1a', color: '#fff' },
  main:      { maxWidth: 820, margin: '0 auto', padding: '28px 20px' },
};
