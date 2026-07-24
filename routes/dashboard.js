const express = require('express');
const { query } = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ---------------------------------------------------------------------
// GET /dashboard — content varies by req.user.role_name
// ---------------------------------------------------------------------
router.get('/dashboard', requireAuth, async (req, res, next) => {
  const { role_name: role } = req.user;
  const viewData = { title: 'Dashboard', role };

  try {
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

    if (['player', 'coach', 'tm', 'admin'].includes(role)) {
      const { rows: nextFixture } = await query(
        `SELECT * FROM fixtures WHERE status IN ('scheduled', 'live')
         ORDER BY match_date ASC LIMIT 1`
      );
      viewData.nextFixture = nextFixture[0] || null;
      viewData.membershipActive = req.user.is_membership_active;
    }

    if (role === 'admin') {
      const { rows: pendingApprovals } = await query(
        `SELECT u.id, u.full_name, u.email, r.name AS role_name, u.is_membership_active
         FROM users u JOIN roles r ON r.id = u.role_id
         WHERE r.name IN ('player', 'coach', 'tm', 'treasurer') AND u.is_membership_active = FALSE
         ORDER BY u.created_at DESC LIMIT 10`
      );
      viewData.pendingApprovals = pendingApprovals;
    }

    if (role === 'fan') {
      const { rows: latestFixture } = await query(
        `SELECT * FROM fixtures WHERE status = 'finished' ORDER BY match_date DESC LIMIT 1`
      );
      viewData.latestFixture = latestFixture[0] || null;
    }

    res.render('dashboard', viewData);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
