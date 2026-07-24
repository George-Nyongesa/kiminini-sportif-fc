const express = require('express');
const { query } = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ---------------------------------------------------------------------
// GET /  — Homepage: live ticker, upcoming fixtures, squad showcase
// ---------------------------------------------------------------------
router.get('/', async (req, res, next) => {
  try {
    const { rows: liveFixtures } = await query(
      `SELECT * FROM fixtures WHERE status = 'live' ORDER BY match_date ASC`
    );
    const { rows: upcoming } = await query(
      `SELECT * FROM fixtures WHERE status = 'scheduled' AND match_date >= NOW()
       ORDER BY match_date ASC LIMIT 5`
    );
    const { rows: recentResults } = await query(
      `SELECT * FROM fixtures WHERE status = 'finished' ORDER BY match_date DESC LIMIT 5`
    );
    const { rows: squad } = await query(
      `SELECT p.id, p.jersey_number, p.position, p.photo_url, p.is_captain, u.full_name
       FROM players p JOIN users u ON u.id = p.user_id
       WHERE p.is_public = TRUE ORDER BY p.jersey_number ASC NULLS LAST LIMIT 8`
    );

    res.render('index', {
      title: 'Kiminini Sportif FC',
      liveFixtures,
      upcoming,
      recentResults,
      squad,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// GET /fixtures — full upcoming fixture list
// ---------------------------------------------------------------------
router.get('/fixtures', async (req, res, next) => {
  try {
    const { rows: fixtures } = await query(
      `SELECT * FROM fixtures WHERE status IN ('scheduled', 'live') ORDER BY match_date ASC`
    );
    res.render('fixtures', { title: 'Fixtures', fixtures });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// GET /results — completed match results
// ---------------------------------------------------------------------
router.get('/results', async (req, res, next) => {
  try {
    const { rows: results } = await query(
      `SELECT * FROM fixtures WHERE status = 'finished' ORDER BY match_date DESC`
    );
    res.render('results', { title: 'Results', results });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// GET /squad — public squad list
// ---------------------------------------------------------------------
router.get('/squad', async (req, res, next) => {
  try {
    const { rows: squad } = await query(
      `SELECT p.id, p.jersey_number, p.position, p.photo_url, p.is_captain, u.full_name
       FROM players p JOIN users u ON u.id = p.user_id
       WHERE p.is_public = TRUE ORDER BY p.jersey_number ASC NULLS LAST`
    );
    res.render('squad', { title: 'Squad', squad });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// GET /pay-dues — membership payment page (post-registration redirect target)
// ---------------------------------------------------------------------
router.get('/pay-dues', requireAuth, (req, res) => {
  res.render('pay-dues', { title: 'Pay Membership Dues' });
});

module.exports = router;
