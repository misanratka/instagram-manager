const crypto = require('crypto');
const fs = require('fs');

// All SQL uses each $n placeholder once, in order, so it also runs on the SQLite fallback.
function createStore(db) {
  return {
    // ── engine ──
    async listPages(accountId, { enabledOnly = true } = {}) {
      const cols = 'id, user_id, name, username, ap_enabled, ap_per_day, ap_start_hour, ap_end_hour, ap_tz, ap_layout, ap_credit_line, ap_paused_reason, ap_fail_streak';
      if (accountId) return db.all(`SELECT ${cols} FROM accounts WHERE id=$1`, [accountId]);
      return db.all(`SELECT ${cols} FROM accounts ${enabledOnly ? 'WHERE ap_enabled=1' : ''} ORDER BY created_at ASC`);
    },
    async countToday(accountId, sinceIso) {
      const r = await db.get(`SELECT COUNT(*) AS n FROM autopilot_queue WHERE account_id=$1 AND started_at>=$2 AND status IN ('posted','processing')`, [accountId, sinceIso]);
      return Number(r?.n || 0);
    },
    nextQueued: (accountId) => db.get(`SELECT * FROM autopilot_queue WHERE account_id=$1 AND status='queued' ORDER BY created_at ASC LIMIT 1`, [accountId]),
    markProcessing: (id, iso) => db.run(`UPDATE autopilot_queue SET status='processing', attempts=COALESCE(attempts,0)+1, started_at=$1, error=NULL WHERE id=$2`, [iso, id]),
    setPostId: (id, postId) => db.run(`UPDATE autopilot_queue SET post_id=$1 WHERE id=$2`, [postId, id]),
    markPosted: (id, postId, iso) => db.run(`UPDATE autopilot_queue SET status='posted', post_id=$1, finished_at=$2, error=NULL WHERE id=$3`, [postId, iso, id]),
    markRetry: (id, error) => db.run(`UPDATE autopilot_queue SET status='queued', error=$1 WHERE id=$2`, [error, id]),
    markFailed: (id, error, iso) => db.run(`UPDATE autopilot_queue SET status='failed', error=$1, finished_at=$2 WHERE id=$3`, [error, iso, id]),
    getPost: (postId) => db.get(`SELECT status, error_message, local_video_path, enhanced_video_path FROM posts WHERE id=$1`, [postId]),
    staleProcessing: () => db.all(`SELECT * FROM autopilot_queue WHERE status='processing'`),
    async bumpFail(accountId) {
      await db.run(`UPDATE accounts SET ap_fail_streak=COALESCE(ap_fail_streak,0)+1 WHERE id=$1`, [accountId]);
      const r = await db.get(`SELECT ap_fail_streak FROM accounts WHERE id=$1`, [accountId]);
      return Number(r?.ap_fail_streak || 0);
    },
    resetFail: (accountId) => db.run(`UPDATE accounts SET ap_fail_streak=0, ap_paused_reason=NULL WHERE id=$1`, [accountId]),
    pause: (accountId, reason) => db.run(`UPDATE accounts SET ap_paused_reason=$1 WHERE id=$2`, [reason, accountId]),
    // The server disk is temporary and small: delete the video files once a post is live.
    async removeFiles(post) {
      for (const p of [post?.local_video_path, post?.enhanced_video_path]) {
        try { if (p && fs.existsSync(p)) fs.unlinkSync(p); } catch { /* ignore */ }
      }
    },

    // ── routes ──
    getAccount: (id) => db.get(`SELECT id, user_id, name, username, ap_enabled, ap_per_day, ap_start_hour, ap_end_hour, ap_tz, ap_layout, ap_credit_line, ap_paused_reason, ap_fail_streak FROM accounts WHERE id=$1`, [id]),
    listAccountsForUser: (userId) => db.all(`SELECT id, user_id, name, username, ap_enabled, ap_per_day, ap_start_hour, ap_end_hour, ap_tz, ap_layout, ap_credit_line, ap_paused_reason, ap_fail_streak FROM accounts WHERE user_id=$1 ORDER BY created_at ASC`, [userId]),
    async queueCounts(accountId) {
      const rows = await db.all(`SELECT status, COUNT(*) AS n FROM autopilot_queue WHERE account_id=$1 GROUP BY status`, [accountId]);
      return Object.fromEntries(rows.map(r => [r.status, Number(r.n)]));
    },
    async lastError(accountId) {
      const r = await db.get(`SELECT error FROM autopilot_queue WHERE account_id=$1 AND status='failed' ORDER BY finished_at DESC LIMIT 1`, [accountId]);
      return r?.error || null;
    },
    listItems: (accountId, limit = 30) => db.all(`SELECT id, url, status, error, attempts, post_id, created_at, started_at, finished_at FROM autopilot_queue WHERE account_id=$1 ORDER BY created_at DESC LIMIT ${Math.min(100, Math.max(1, Number(limit) || 30))}`, [accountId]),
    getItem: (id) => db.get(`SELECT * FROM autopilot_queue WHERE id=$1`, [id]),
    async addItem(accountId, url, options, iso) {
      const dup = await db.get(`SELECT id FROM autopilot_queue WHERE account_id=$1 AND url=$2 AND status IN ('queued','processing','posted')`, [accountId, url]);
      if (dup) return { duplicate: true };
      const id = crypto.randomUUID();
      await db.run(`INSERT INTO autopilot_queue (id, account_id, url, options, status, attempts, created_at) VALUES ($1,$2,$3,$4,'queued',0,$5)`,
        [id, accountId, url, options ? JSON.stringify(options) : null, iso]);
      return { id };
    },
    deleteItem: (id) => db.run(`DELETE FROM autopilot_queue WHERE id=$1 AND status<>'processing'`, [id]),
    retryItem: (id) => db.run(`UPDATE autopilot_queue SET status='queued', attempts=0, error=NULL WHERE id=$1 AND status='failed'`, [id]),
    async updateSettings(accountId, s) {
      const sets = [], vals = [];
      const add = (col, v) => { vals.push(v); sets.push(`${col}=$${vals.length}`); };
      if (s.enabled !== undefined)     add('ap_enabled', s.enabled ? 1 : 0);
      if (s.per_day !== undefined)     add('ap_per_day', s.per_day);
      if (s.start_hour !== undefined)  add('ap_start_hour', s.start_hour);
      if (s.end_hour !== undefined)    add('ap_end_hour', s.end_hour);
      if (s.tz !== undefined)          add('ap_tz', s.tz);
      if (s.layout !== undefined)      add('ap_layout', s.layout);
      if (s.credit_line !== undefined) add('ap_credit_line', s.credit_line ? 1 : 0);
      if (!sets.length) return;
      vals.push(accountId);
      await db.run(`UPDATE accounts SET ${sets.join(', ')} WHERE id=$${vals.length}`, vals);
    }
  };
}

module.exports = { createStore };
