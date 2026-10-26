const { Pool } = require('pg');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const logger = require('../services/logger');

let adapter;

function getDB() {
  if (!adapter) throw new Error('Database not initialized. Call initDB() first.');
  return adapter;
}

async function initDB() {
  if (process.env.DATABASE_URL) {
    await initPostgres();
  } else {
    initSQLite();
  }
  logger.info('Database initialized');
}

async function initPostgres() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS accounts (
      id            TEXT PRIMARY KEY,
      user_id       TEXT,
      name          TEXT NOT NULL,
      username      TEXT NOT NULL,
      ig_user_id    TEXT NOT NULL,
      access_token  TEXT NOT NULL,
      token_scopes  TEXT,
      fallback_username TEXT,
      fallback_session_path TEXT,
      fallback_connected_at TIMESTAMPTZ,
      caption_style TEXT NOT NULL DEFAULT 'casual',
      caption_prompt TEXT,
      created_at    TIMESTAMPTZ DEFAULT NOW(),
      token_connected_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS user_id TEXT`).catch(() => {});
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS token_connected_at TIMESTAMPTZ DEFAULT NOW()`).catch(() => {});
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS token_scopes TEXT`).catch(() => {});
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS fallback_username TEXT`).catch(() => {});
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS fallback_session_path TEXT`).catch(() => {});
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS fallback_connected_at TIMESTAMPTZ`).catch(() => {});
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS brand_name TEXT`).catch(() => {});
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS brand_handle TEXT`).catch(() => {});
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS brand_verified INTEGER DEFAULT 0`).catch(() => {});
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS brand_avatar TEXT`).catch(() => {});
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS brand_theme TEXT DEFAULT 'dark'`).catch(() => {});
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ap_enabled INTEGER DEFAULT 0`).catch(() => {});
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ap_per_day INTEGER DEFAULT 2`).catch(() => {});
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ap_start_hour INTEGER DEFAULT 9`).catch(() => {});
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ap_end_hour INTEGER DEFAULT 22`).catch(() => {});
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ap_tz TEXT`).catch(() => {});
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ap_layout TEXT DEFAULT 'card'`).catch(() => {});
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ap_credit_line INTEGER DEFAULT 1`).catch(() => {});
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ap_paused_reason TEXT`).catch(() => {});
  await pool.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ap_fail_streak INTEGER DEFAULT 0`).catch(() => {});
  await pool.query(`
    CREATE TABLE IF NOT EXISTS autopilot_queue (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      url TEXT NOT NULL,
      options TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      error TEXT,
      post_id TEXT,
      attempts INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      finished_at TIMESTAMPTZ
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_autopilot_queue_account ON autopilot_queue (account_id, status)`).catch(() => {});
  await pool.query(`
    CREATE TABLE IF NOT EXISTS posts (
      id                  TEXT PRIMARY KEY,
      account_id          TEXT,
      video_url           TEXT,
      local_video_path    TEXT,
      enhanced_video_path TEXT,
      original_caption    TEXT,
      generated_caption   TEXT,
      hook_text           TEXT,
      subtitles_srt       TEXT,
      final_caption       TEXT,
      status              TEXT NOT NULL DEFAULT 'draft',
      scheduled_at        TIMESTAMPTZ,
      posted_at           TIMESTAMPTZ,
      ig_media_id         TEXT,
      error_message       TEXT,
      created_at          TIMESTAMPTZ DEFAULT NOW(),
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
    )
  `);

  adapter = {
    async get(sql, params = []) {
      const r = await pool.query(sql, params);
      return r.rows[0] || null;
    },
    async all(sql, params = []) {
      const r = await pool.query(sql, params);
      return r.rows;
    },
    async run(sql, params = []) {
      await pool.query(sql, params);
    }
  };
}

function initSQLite() {
  const dbPath = process.env.DB_PATH || './data/instagram_manager.db';
  const dbDir = path.dirname(path.resolve(dbPath));
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });

  const sqlite = new DatabaseSync(path.resolve(dbPath));
  sqlite.exec('PRAGMA journal_mode = WAL');
  sqlite.exec('PRAGMA foreign_keys = ON');
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS accounts (
      id            TEXT PRIMARY KEY,
      user_id       TEXT,
      name          TEXT NOT NULL,
      username      TEXT NOT NULL,
      ig_user_id    TEXT NOT NULL,
      access_token  TEXT NOT NULL,
      token_scopes  TEXT,
      fallback_username TEXT,
      fallback_session_path TEXT,
      fallback_connected_at DATETIME,
      caption_style TEXT NOT NULL DEFAULT 'casual',
      caption_prompt TEXT,
      brand_name TEXT,
      brand_handle TEXT,
      brand_verified INTEGER DEFAULT 0,
      brand_avatar TEXT,
      brand_theme TEXT DEFAULT 'dark',
      created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
      token_connected_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS posts (
      id                  TEXT PRIMARY KEY,
      account_id          TEXT,
      video_url           TEXT,
      local_video_path    TEXT,
      enhanced_video_path TEXT,
      original_caption    TEXT,
      generated_caption   TEXT,
      hook_text           TEXT,
      subtitles_srt       TEXT,
      final_caption       TEXT,
      status              TEXT NOT NULL DEFAULT 'draft',
      scheduled_at        DATETIME,
      posted_at           DATETIME,
      ig_media_id         TEXT,
      error_message       TEXT,
      created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE SET NULL
    );
  `);

  // Autopilot (columns added with try/catch because SQLite has no ADD COLUMN IF NOT EXISTS)
  for (const [c, t] of [['ap_enabled', "INTEGER DEFAULT 0"], ['ap_per_day', "INTEGER DEFAULT 2"], ['ap_start_hour', "INTEGER DEFAULT 9"], ['ap_end_hour', "INTEGER DEFAULT 22"], ['ap_tz', "TEXT"], ['ap_layout', "TEXT DEFAULT 'card'"], ['ap_credit_line', "INTEGER DEFAULT 1"], ['ap_paused_reason', "TEXT"], ['ap_fail_streak', "INTEGER DEFAULT 0"]]) {
    try { sqlite.exec(`ALTER TABLE accounts ADD COLUMN ${c} ${t}`); } catch { /* already there */ }
  }
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS autopilot_queue (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      url TEXT NOT NULL,
      options TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      error TEXT,
      post_id TEXT,
      attempts INTEGER DEFAULT 0,
      created_at TEXT,
      started_at TEXT,
      finished_at TEXT
    )
  `);

  adapter = {
    async get(sql, params = []) {
      return sqlite.prepare(sql).get(...params) || null;
    },
    async all(sql, params = []) {
      return sqlite.prepare(sql).all(...params);
    },
    async run(sql, params = []) {
      sqlite.prepare(sql).run(...params);
    }
  };
}

module.exports = { getDB, initDB };
