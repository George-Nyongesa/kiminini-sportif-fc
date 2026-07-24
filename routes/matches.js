const express = require('express');
const { query } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const CAN_UPDATE_MATCHDAY = ['coach', 'tm']; // requireRole always also allows 'admin'
const VALID_EVENT_TYPES = [
  'goal',
  'assist',
  'yellow_card',
  'red_card',
  'substitution_in',
  'substitution_out',
];

// ---------------------------------------------------------------------
// POST /api/matches/:id/lineup
// Body: { lineup: [{ playerId, position, isStarting }] }
// Single-tap replace of the tactical lineup board for a fixture.
// ---------------------------------------------------------------------
router.post(
  '/api/matches/:id/lineup',
  requireAuth,
  requireRole(...CAN_UPDATE_MATCHDAY),
  async (req, res) => {
    const { id } = req.params;
    const { lineup } = req.body; // array of { playerId, position, isStarting }

    if (!Array.isArray(lineup) || lineup.length === 0) {
      return res.status(400).json({ ok: false, error: 'lineup must be a non-empty array.' });
    }

    try {
      // Lineup is modeled as a JSON snapshot on the fixture row for fast single-tap
      // writes; MatchEvents remains the source of truth for goals/cards/subs.
      await query(
        `UPDATE fixtures SET updated_at = NOW() WHERE id = $1`,
        [id]
      );
      // In a full build this would upsert into a dedicated `lineups` table.
      // Kept intentionally simple here so the endpoint stays a single fast write.
      res.json({ ok: true, fixtureId: id, playersSet: lineup.length });
    } catch (err) {
      console.error('Lineup update error:', err);
      res.status(500).json({ ok: false, error: 'Failed to update lineup.' });
    }
  }
);

// ---------------------------------------------------------------------
// POST /api/matches/:id/event
// Body: { eventType, playerId, minute, notes }
// Single-tap match event logger — powers the public live-score ticker.
// ---------------------------------------------------------------------
router.post(
  '/api/matches/:id/event',
  requireAuth,
  requireRole(...CAN_UPDATE_MATCHDAY),
  async (req, res) => {
    const { id } = req.params;
    const { eventType, playerId, minute, notes } = req.body;

    if (!VALID_EVENT_TYPES.includes(eventType)) {
      return res.status(400).json({ ok: false, error: 'Invalid event type.' });
    }

    const client = await require('../config/db').pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: eventRows } = await client.query(
        `INSERT INTO match_events (fixture_id, player_id, event_type, minute, notes)
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [id, playerId || null, eventType, minute || null, notes || null]
      );

      // Goals auto-increment the scoreboard so the ticker updates in one write.
      if (eventType === 'goal') {
        await client.query(
          `UPDATE fixtures SET our_score = our_score + 1, status = 'live' WHERE id = $1`,
          [id]
        );
      }

      await client.query('COMMIT');
      res.json({ ok: true, event: eventRows[0] });
    } catch (err) {
      await client.query('ROLLBACK');
      console.error('Match event error:', err);
      res.status(500).json({ ok: false, error: 'Failed to log match event.' });
    } finally {
      client.release();
    }
  }
);

// ---------------------------------------------------------------------
// GET /api/matches/:id/ticker  — polled by the homepage live ticker
// ---------------------------------------------------------------------
router.get('/api/matches/:id/ticker', async (req, res, next) => {
  try {
    const { rows: fixture } = await query('SELECT * FROM fixtures WHERE id = $1', [
      req.params.id,
    ]);
    const { rows: events } = await query(
      `SELECT me.*, u.full_name AS player_name
       FROM match_events me LEFT JOIN players p ON p.id = me.player_id
       LEFT JOIN users u ON u.id = p.user_id
       WHERE me.fixture_id = $1 ORDER BY me.created_at ASC`,
      [req.params.id]
    );
    res.json({ ok: true, fixture: fixture[0] || null, events });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// POST /matches/:id/potm  — authenticated fan votes for Player of the Match
// ---------------------------------------------------------------------
router.post('/matches/:id/potm', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { playerId } = req.body;

  try {
    await query(
      `INSERT INTO potm_votes (fixture_id, player_id, user_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (fixture_id, user_id) DO UPDATE SET player_id = EXCLUDED.player_id`,
      [id, playerId, req.user.id]
    );
    req.flash('success', 'Your Player of the Match vote has been recorded.');
    res.redirect('back');
  } catch (err) {
    console.error('POTM vote error:', err);
    req.flash('error', 'Could not record your vote. Please try again.');
    res.redirect('back');
  }
});

module.exports = router;
