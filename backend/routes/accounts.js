const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../models/db');
const { verifyToken } = require('../services/instagramPoster');
const { createFallbackSession, getSessionPath, getLegacySessionPath, removeSessionPath } = require('../services/instagramWebPoster');
const logger = require('../services/logger');
const { google } = require('googleapis');

const router = express.Router();

// ── Google Sheets: update account column for a user ───────────────────────────
async function updateSheetAccount(userId, username) {
  try {
    const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS_JSON);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    const sheets = google.sheets({ version: 'v4', auth });

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: 'Sheet1!A:H',
    });

    const rows = response.data.values || [];
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][7] === userId) {
        // Column D (index 3) = Instagram accounts
        const existing = rows[i][3] || '';
        const accounts = existing ? existing.split(', ') : [];
        if (!accounts.includes(username)) accounts.push(username);
        await sheets.spreadsheets.values.update({
          spreadsheetId: process.env.GOOGLE_SHEET_ID,
          range: `Sheet1!D${i + 1}`,
          valueInputOption: 'RAW',
          requestBody: { values: [[accounts.join(', ')]] },
        });
        break;
      }
    }
  } catch (err) {
    console.error('Sheet update error:', err.message);
  }
}

// GET all accounts — filtered by user
router.get('/', async (req, res, next) => {
  try {
    const userId = req.headers['x-user-id'];
    const accounts = await getDB().all(
      `SELECT id, name, username, ig_user_id, access_token, token_scopes, fallback_username, fallback_session_path, fallback_connected_at, caption_style, caption_prompt, created_at, token_connected_at,
              CASE WHEN access_token IS NOT NULL AND access_token <> '' THEN 1 ELSE 0 END as has_token
       FROM accounts WHERE user_id=$1 ORDER BY created_at DESC`,
      [userId]
    );
    res.json(accounts);
  } catch (err) { next(err); }
});

router.post('/:id/fallback-session', async (req, res, next) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }
    const db = getDB();
    const account = await db.get('SELECT id, name, username, ig_user_id FROM accounts WHERE id=$1', [req.params.id]);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    const { sessionPath } = await createFallbackSession(account.id, username, password);
    await db.run(
      'UPDATE accounts SET fallback_username=$1, fallback_session_path=$2, fallback_connected_at=CURRENT_TIMESTAMP WHERE id=$3',
      [username, sessionPath, account.id]
    );
    res.json({ message: 'Instagram fallback session created', accountId: account.id, username, sessionPath });
  } catch (err) { next(err); }
});

router.delete('/:id/fallback-session', async (req, res, next) => {
  try {
    const db = getDB();
    const account = await db.get('SELECT id, fallback_session_path FROM accounts WHERE id=$1', [req.params.id]);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    const sessionPaths = [account.fallback_session_path, getSessionPath(account.id), getLegacySessionPath(account.id)].filter(Boolean);
    for (const sessionPath of sessionPaths) removeSessionPath(sessionPath);
    await db.run(
      'UPDATE accounts SET fallback_username=NULL, fallback_session_path=NULL, fallback_connected_at=NULL WHERE id=$1',
      [account.id]
    );
    res.json({ message: 'Instagram fallback session cleared', accountId: account.id });
  } catch (err) { next(err); }
});

// POST new account — save with user_id and update sheet
router.post('/', async (req, res, next) => {
  try {
    const { name, ig_user_id, access_token, token_scopes, caption_style, caption_prompt } = req.body;
    const userId = req.headers['x-user-id'];
    if (!name || !ig_user_id || !access_token)
      return res.status(400).json({ error: 'name, ig_user_id, and access_token are required' });

    const id = uuidv4();
    let username = name;
    if (ig_user_id && access_token) {
      try {
        const igData = await verifyToken(ig_user_id, access_token);
        username = igData.username || igData.name || name;
      } catch (err) {
        logger.warn('Token verification failed, saving account anyway:', err.message);
      }
    }

    await getDB().run(
      `INSERT INTO accounts (id, user_id, name, username, ig_user_id, access_token, token_scopes, caption_style, caption_prompt, token_connected_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)`,
      [id, userId, name, username, ig_user_id || null, access_token || null, token_scopes || null, caption_style || 'casual', caption_prompt || null]
    );

    // Update Google Sheet with the new IG account
    if (userId) await updateSheetAccount(userId, username);

    res.json({ id, username, message: 'Account added successfully' });
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { caption_style, caption_prompt, access_token, token_scopes, name } = req.body;
    const db = getDB();
    if (access_token) {
      const existing = await db.get('SELECT ig_user_id FROM accounts WHERE id=$1', [req.params.id]);
      if (existing) await verifyToken(existing.ig_user_id, access_token);
      await db.run(
        'UPDATE accounts SET access_token=$1, token_scopes=COALESCE($2, token_scopes), token_connected_at=CURRENT_TIMESTAMP WHERE id=$3',
        [access_token, token_scopes || null, req.params.id]
      );
    }
    await db.run(
      `UPDATE accounts SET name=COALESCE($1,name), caption_style=COALESCE($2,caption_style), caption_prompt=COALESCE($3,caption_prompt) WHERE id=$4`,
      [name || null, caption_style || null, caption_prompt || null, req.params.id]
    );
    res.json({ message: 'Account updated' });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await getDB().run('DELETE FROM accounts WHERE id=$1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
