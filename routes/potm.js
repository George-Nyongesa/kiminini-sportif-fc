const express = require('express');
const { query } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { validatePOTMVote } = require('../middleware/validators');
const { validationResult } = require('express-validator');

const router = express.Router();

// ---------------------------------------------------------------------
// GET /potm/vote — Fetch active match & player candidate roster
// ---------------------------------------------------------------------
router.get('/vote', requireAuth, async (req, res, next) => {
  try {
    // 1. Get the latest finished match available for voting
    const { rows: fixtureRows } = await query(
      `SELECT id, opponent, our_score, opponent_score, match_date 
       FROM fixtures 
       WHERE status = 'finished' 
       ORDER BY match_date DESC 
       LIMIT 1`
    );

    const latestFixture = fixtureRows[0] || null;
    let candidatePlayers = [];
    let hasVoted = false;

    if (latestFixture) {
      // 2. Fetch public team squad roster eligible for voting
      const { rows: playerRows } = await query(
        `SELECT p.id AS player_id, u.full_name, p.position, p.squad_number 
         FROM players p
         JOIN users u ON p.user_id = u.id
         WHERE p.is_public = TRUE
         ORDER BY p.squad_number ASC NULLS LAST`
      );
      candidatePlayers = playerRows;

      // 3. Check if current user already voted for this fixture
      const { rows: existingVote } = await query(
        `SELECT id FROM potm_votes WHERE fixture_id = $1 AND user_id = $2`,
        [latestFixture.id, req.user.id]
      );
      hasVoted = existingVote.length > 0;
    }

    res.render('potm/vote', {
      title: 'Player of the Match Voting',
      latestFixture,
      candidatePlayers,
      hasVoted
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// POST /potm/vote — Process and record fan POTM vote
// ---------------------------------------------------------------------
router.post('/vote', requireAuth, validatePOTMVote, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    errors.array().forEach((e) => req.flash('error', e.msg));
    return res.redirect('/potm/vote');
  }

  const { fixture_id, player_id } = req.body;

  try {
    const { rows: existing } = await query(
      `SELECT id FROM potm_votes WHERE fixture_id = $1 AND user_id = $2`,
      [fixture_id, req.user.id]
    );

    if (existing.length > 0) {
      req.flash('error', 'You have already submitted your vote for this match.');
      return res.redirect('/dashboard');
    }

    await query(
      `INSERT INTO potm_votes (fixture_id, user_id, player_id, created_at)
       VALUES ($1, $2, $3, NOW())`,
      [fixture_id, req.user.id, player_id]
    );

    req.flash('success', 'Thank you! Your Player of the Match vote has been logged.');
    return res.redirect('/dashboard');
  } catch (err) {
    console.error('POTM Vote Submission Error:', err);
    req.flash('error', 'Failed to register your vote. Please try again.');
    return res.redirect('/potm/vote');
  }
});

// ---------------------------------------------------------------------
// GET /potm/leaderboard — Display POTM winners & season leaderboard
// ---------------------------------------------------------------------
router.get('/leaderboard', requireAuth, async (req, res, next) => {
  try {
    // 1. Query season leaderboard (Total POTM awards per player)
    const { rows: leaderboard } = await query(
      `WITH match_winners AS (
        SELECT DISTINCT ON (v.fixture_id)
          v.fixture_id,
          v.player_id,
          COUNT(v.id) AS vote_count
        FROM potm_votes v
        GROUP BY v.fixture_id, v.player_id
        ORDER BY v.fixture_id, vote_count DESC
      )
      SELECT 
        p.id AS player_id,
        u.full_name,
        p.squad_number,
        p.position,
        COUNT(mw.fixture_id) AS total_potm_awards
      FROM match_winners mw
      JOIN players p ON mw.player_id = p.id
      JOIN users u ON p.user_id = u.id
      GROUP BY p.id, u.full_name, p.squad_number, p.position
      ORDER BY total_potm_awards DESC, u.full_name ASC`
    );

    // 2. Query vote counts for the latest finished match
    const { rows: latestFixture } = await query(
      `SELECT id, opponent, match_date FROM fixtures WHERE status = 'finished' ORDER BY match_date DESC LIMIT 1`
    );

    let latestMatchBreakdown = [];
    if (latestFixture[0]) {
      const { rows: breakdown } = await query(
        `SELECT 
          p.id AS player_id,
          u.full_name,
          p.squad_number,
          COUNT(v.id) AS vote_count
        FROM potm_votes v
        JOIN players p ON v.player_id = p.id
        JOIN users u ON p.user_id = u.id
        WHERE v.fixture_id = $1
        GROUP BY p.id, u.full_name, p.squad_number
        ORDER BY vote_count DESC`,
        [latestFixture[0].id]
      );
      latestMatchBreakdown = breakdown;
    }

    res.render('potm/leaderboard', {
      title: 'POTM Leaderboard',
      leaderboard,
      latestFixture: latestFixture[0] || null,
      latestMatchBreakdown
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;