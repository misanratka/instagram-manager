const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getDB } = require('../models/db');
const { verifyToken } = require('../services/instagramPoster');

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
    const accounts = await getDB().all(
      'SELECT id, name, username, ig_user_id, caption_style, caption_prompt, created_at FROM accounts ORDER BY created_at DESC'
    );
    res.json(accounts);
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    const { name, ig_user_id, access_token, caption_style, caption_prompt } = req.body;
    if (!name || !ig_user_id || !access_token)
      return res.status(400).json({ error: 'name, ig_user_id, and access_token are required' });

    const igData = await verifyToken(ig_user_id, access_token);
    const id = uuidv4();

    await getDB().run(
      `INSERT INTO accounts (id, name, username, ig_user_id, access_token, caption_style, caption_prompt)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, name, igData.username || name, ig_user_id, access_token, caption_style || 'casual', caption_prompt || null]
    );

    res.json({ id, username: igData.username, message: 'Account verified and added' });
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const { caption_style, caption_prompt, access_token, name } = req.body;
    const db = getDB();

    if (access_token) {
      const existing = await db.get('SELECT ig_user_id FROM accounts WHERE id=$1', [req.params.id]);
      if (existing) await verifyToken(existing.ig_user_id, access_token);
      await db.run('UPDATE accounts SET access_token=$1 WHERE id=$2', [access_token, req.params.id]);
    }

    await db.run(
      `UPDATE accounts SET
         name          = COALESCE($1, name),
         caption_style = COALESCE($2, caption_style),
         caption_prompt = COALESCE($3, caption_prompt)
       WHERE id = $4`,
      [name || null, caption_style || null, caption_prompt || null, req.params.id]
    );

    res.json({ message: 'Account updated' });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    await getDB().run('DELETE FROM accounts WHERE id=$1', [req.params.id]);
    res.json({ message: 'Account deleted' });
  } catch (err) { next(err); }
});

module.exports = router;
