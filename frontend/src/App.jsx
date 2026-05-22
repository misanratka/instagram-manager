import React, { useState } from 'react';
import NewPost from './components/NewPost';
import PostHistory from './components/PostHistory';
import AccountManager from './components/AccountManager';

const TABS = [
  { id: 'new',      icon: '＋', label: 'Create'   },
  { id: 'history',  icon: '▦',  label: 'Posts'    },
  { id: 'accounts', icon: '◎',  label: 'Accounts' },
];

export default function App() {
  const [tab, setTab] = useState('new');
  return (
    <div style={s.wrap}>
      <header style={s.header}>
        <div style={s.logo}>
          <div style={s.logoIcon}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <rect x="2" y="2" width="20" height="20" rx="6" fill="url(#ig)"/>
              <circle cx="12" cy="12" r="4.5" stroke="#fff" strokeWidth="2"/>
              <circle cx="17.5" cy="6.5" r="1.2" fill="#fff"/>
              <defs>
                <linearGradient id="ig" x1="2" y1="22" x2="22" y2="2">
                  <stop offset="0%" stopColor="#f97316"/>
                  <stop offset="50%" stopColor="#e6356a"/>
                  <stop offset="100%" stopColor="#a855f7"/>
                </linearGradient>
              </defs>
            </svg>
          </div>
          <span style={s.logoText}>InstaManager</span>
        </div>
        <div style={s.headerRight}>
          <span style={s.aiBadge}>✦ AI</span>
        </div>
      </header>

      <main style={s.main}>
        {tab === 'new'      && <NewPost />}
        {tab === 'history'  && <PostHistory />}
        {tab === 'accounts' && <AccountManager />}
      </main>

      <nav style={s.tabBar}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ ...s.tabBtn, ...(tab === t.id ? s.tabActive : {}) }}>
            <span style={{ fontSize: 20 }}>{t.icon}</span>
            <span style={s.tabLabel}>{t.label}</span>
            {tab === t.id && <div style={s.tabLine} />}
          </button>
        ))}
      </nav>
    </div>
  );
}

const s = {
  wrap:        { minHeight: '100vh', background: '#0c0f14', display: 'flex', flexDirection: 'column', fontFamily: '-apple-system,BlinkMacSystemFont,"SF Pro Display",sans-serif', paddingBottom: 70 },
  header:      { height: 58, padding: '0 20px', background: '#0c0f14', borderBottom: '1px solid #1a1f2e', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 50 },
  logo:        { display: 'flex', alignItems: 'center', gap: 10 },
  logoIcon:    { width: 36, height: 36, borderRadius: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#141824' },
  logoText:    { fontWeight: 700, fontSize: 18, color: '#fff', letterSpacing: '-0.4px' },
  headerRight: { display: 'flex', alignItems: 'center', gap: 10 },
  aiBadge:     { fontSize: 11, fontWeight: 700, color: '#38bdf8', background: 'rgba(56,189,248,0.1)', border: '1px solid rgba(56,189,248,0.2)', borderRadius: 20, padding: '4px 10px', letterSpacing: '0.5px' },
  main:        { flex: 1, maxWidth: 860, margin: '0 auto', width: '100%', padding: '20px 16px' },
  tabBar:      { position: 'fixed', bottom: 0, left: 0, right: 0, height: 64, background: '#0c0f14', borderTop: '1px solid #1a1f2e', display: 'flex', alignItems: 'center', justifyContent: 'space-around', zIndex: 100, paddingBottom: 'env(safe-area-inset-bottom)' },
  tabBtn:      { flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, background: 'none', border: 'none', cursor: 'pointer', color: '#3a4255', padding: '8px 0', position: 'relative', transition: 'color .2s' },
  tabActive:   { color: '#38bdf8' },
  tabLabel:    { fontSize: 11, fontWeight: 600 },
  tabLine:     { position: 'absolute', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: 20, height: 2, background: '#38bdf8', borderRadius: 2 },
};
