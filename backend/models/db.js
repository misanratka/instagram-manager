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
    ssl: { rejectUnauthorized: false }
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
