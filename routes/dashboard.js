const express = require('express');
const { query } = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ---------------------------------------------------------------------
// GET /dashboard — content varies by req.user.role_name
// ---------------------------------------------------------------------
router.get('/dashboard', requireAuth, async (req, res, next) => {
  const { role_name: role } = req.user;
  const viewData = { title: 'Dashboard', role, currentUser: req.user };

  try {
    // 1. Fetch latest completed fixture (Used by Fan Hub POTM card & general overview)
    const { rows: completedFixtures } = await query(
      `SELECT id, opponent, our_score, opponent_score, match_date, venue, competition 
       FROM fixtures 
       WHERE status = 'finished' 
       ORDER BY match_date DESC 
       LIMIT 1`
    );
    viewData.latestFixture = completedFixtures[0] || null;

    // 2. Financial Metrics (Treasurer & Admin)
    if (role === 'treasurer' || role === 'admin') {
      const { rows: recentPayments } = await query(
        `SELECT p.*, u.full_name FROM payments p JOIN users u ON u.id = p.user_id
         ORDER BY p.created_at DESC LIMIT 10`
      );
      const { rows: totals } = await query(
        `SELECT COALESCE(SUM(amount), 0) AS total_collected
         FROM payments WHERE status = 'completed'`
      );
      viewData.recentPayments = recentPayments;
      viewData.totalCollected = totals[0].total_collected;
    }

    // 3. Matchday & Squad Metrics (Player, Coach, TM, Admin)
    if (['player', 'coach', 'tm', 'admin'].includes(role)) {
      const { rows: nextFixture } = await query(
        `SELECT * FROM fixtures WHERE status IN ('scheduled', 'live')
         ORDER BY match_date ASC LIMIT 1`
      );
      viewData.nextFixture = nextFixture[0] || null;
      viewData.membershipActive = req.user.is_membership_active;
    }

    // 4. Admin Management Data (Fixtures, Approvals & User Directory)
    if (role === 'admin') {
      // Pending / Scheduled Fixtures
      const { rows: pendingResults } = await query(
        `SELECT id, opponent, match_date, venue, competition, home_away, status 
         FROM fixtures 
         WHERE status = 'scheduled' 
         ORDER BY match_date ASC`
      );
      viewData.pendingResults = pendingResults;

      // Completed Fixtures for Edit / Reset / Delete
      const { rows: finishedFixtures } = await query(
        `SELECT id, opponent, match_date, venue, competition, home_away, our_score, opponent_score, status 
         FROM fixtures 
         WHERE status = 'finished' 
         ORDER BY match_date DESC`
      );
      viewData.finishedFixtures = finishedFixtures;

      // Pending membership approvals
      const { rows: pendingApprovals } = await query(
        `SELECT u.id, u.full_name, u.email, r.name AS role_name, u.is_membership_active
         FROM users u JOIN roles r ON r.id = u.role_id
         WHERE r.name IN ('player', 'coach', 'tm', 'treasurer') AND u.is_membership_active = FALSE
         ORDER BY u.created_at DESC LIMIT 10`
      );
      viewData.pendingApprovals = pendingApprovals;

     // Registered system users (Including avatar_url, phone_number, and role_id)
const { rows: allUsers } = await query(
  `SELECT u.id, u.full_name, u.email, u.phone_number, u.avatar_url, u.is_active, u.role_id, r.name AS role_name
   FROM users u
   JOIN roles r ON r.id = u.role_id
   ORDER BY u.created_at DESC`
);
viewData.allUsers = allUsers;
      viewData.allUsers = allUsers;
    }

    res.render('dashboard', viewData);
  } catch (err) {
    next(err);
  }
});

module.exports = router;