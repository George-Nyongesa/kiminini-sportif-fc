const express = require('express');
const { query } = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ---------------------------------------------------------------------
// GET / — Homepage: live ticker, upcoming fixtures, squad showcase
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

    // Fetch active players only for homepage preview
    const { rows: squad } = await query(
      `SELECT 
         u.id, 
         u.full_name, 
         COALESCE(p.photo_url, u.avatar_url, '/images/default-avatar.png') AS avatar_url, 
         p.jersey_number, 
         COALESCE(p.position, 'Squad Player') AS position, 
         COALESCE(p.is_captain, FALSE) AS is_captain
       FROM users u
       JOIN roles r ON u.role_id = r.id
       LEFT JOIN players p ON u.id = p.user_id
       WHERE LOWER(r.name) = 'player' AND u.is_active = TRUE
       ORDER BY p.jersey_number ASC NULLS LAST 
       LIMIT 8`
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
// GET /squad — public squad list (separated by Players and Staff)
// ---------------------------------------------------------------------
router.get('/squad', async (req, res, next) => {
  try {
    // 1. Fetch active players registered under the 'player' role
    const { rows: players } = await query(
      `SELECT 
         u.id, 
         u.full_name, 
         COALESCE(p.photo_url, u.avatar_url, '/images/default-avatar.png') AS avatar_url, 
         p.jersey_number, 
         COALESCE(p.position, 'Squad Player') AS position, 
         COALESCE(p.is_captain, FALSE) AS is_captain
       FROM users u
       JOIN roles r ON u.role_id = r.id
       LEFT JOIN players p ON u.id = p.user_id
       WHERE LOWER(r.name) = 'player' AND u.is_active = TRUE
       ORDER BY p.jersey_number ASC NULLS LAST, u.full_name ASC`
    );

    // 2. Fetch technical and management staff ONLY (excluding super admin & admin accounts)
    const { rows: staff } = await query(
      `SELECT 
         u.id, 
         u.full_name, 
         COALESCE(u.avatar_url, '/images/default-avatar.png') AS avatar_url, 
         r.name AS role_name
       FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE LOWER(r.name) IN ('coach', 'tm', 'treasurer') 
         AND LOWER(r.name) NOT IN ('admin', 'super_admin', 'superadmin')
         AND u.is_active = TRUE
       ORDER BY u.full_name ASC`
    );

    res.render('squad', {
      title: 'Squad & Technical Staff',
      players,
      staff,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// GET /pay-dues — membership payment page
// ---------------------------------------------------------------------
router.get('/pay-dues', requireAuth, (req, res) => {
  res.render('pay-dues', { title: 'Pay Membership Dues' });
});

module.exports = router;