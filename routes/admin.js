const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { requireAuth, requirePasswordChange, requireRole } = require('../middleware/auth');
const { validateMatchResult } = require('../middleware/validators');

const router = express.Router();

router.use(requireAuth, requirePasswordChange, requireRole('admin'));

// =====================================================================
// 1. USER MANAGEMENT ENDPOINTS
// =====================================================================

// POST /admin/users — Provision a new user account
router.post(
  '/users',
  [
    body('full_name').trim().notEmpty().withMessage('Full name is required.'),
    body('email').isEmail().withMessage('Enter a valid email address.'),
    body('role_id').notEmpty().withMessage('Please select a valid role.'),
    body('temp_password')
      .isLength({ min: 8 })
      .withMessage('Temporary password must be at least 8 characters.'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      errors.array().forEach((e) => req.flash('error', e.msg));
      return res.redirect('/dashboard');
    }

    const { full_name, email, phone_number, role_id, temp_password } = req.body;

    try {
      const { rows: existing } = await query('SELECT id FROM users WHERE email = $1', [
        email.toLowerCase().trim(),
      ]);

      if (existing[0]) {
        req.flash('error', 'A user with that email address already exists.');
        return res.redirect('/dashboard');
      }

      const { rows: roleRow } = await query('SELECT id, name FROM roles WHERE id = $1', [role_id]);
      if (!roleRow.length) {
        req.flash('error', 'Selected role is invalid.');
        return res.redirect('/dashboard');
      }

      const roleName = roleRow[0].name;
      const passwordHash = await bcrypt.hash(temp_password, 12);
      const isMembershipActive = roleName !== 'fan';

      const { rows: created } = await query(
        `INSERT INTO users (
           full_name, email, phone_number, password_hash, role_id, 
           is_membership_active, must_change_password
         )
         VALUES ($1, $2, $3, $4, $5, $6, TRUE)
         RETURNING id, full_name, email`,
        [
          full_name.trim(),
          email.toLowerCase().trim(),
          phone_number || null,
          passwordHash,
          role_id,
          isMembershipActive,
        ]
      );

      const userId = created[0].id;

      if (['player', 'coach', 'tm'].includes(roleName)) {
        await query(
          `INSERT INTO players (user_id, is_public) 
           VALUES ($1, TRUE) 
           ON CONFLICT (user_id) DO NOTHING`,
          [userId]
        );
      }

      req.flash(
        'success',
        `Successfully provisioned account for ${full_name} (${roleName}). Temporary password set.`
      );
      return res.redirect('/dashboard');
    } catch (err) {
      console.error('Provisioning error:', err);
      req.flash('error', 'Failed to provision user account. Please try again.');
      return res.redirect('/dashboard');
    }
  }
);

// POST /admin/users/:id/reset-password — Issue temporary password reset
router.post('/users/:id/reset-password', async (req, res) => {
  const { id } = req.params;
  const tempPassword = req.body.temp_password || 'Reset2026!';

  try {
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    const { rowCount } = await query(
      `UPDATE users 
       SET password_hash = $1, must_change_password = TRUE, updated_at = NOW() 
       WHERE id = $2`,
      [passwordHash, id]
    );

    if (rowCount === 0) {
      req.flash('error', 'User not found.');
    } else {
      req.flash('success', 'Temporary password reset successfully.');
    }

    return res.redirect('/dashboard');
  } catch (err) {
    console.error('Admin Password Reset Error:', err);
    req.flash('error', 'Failed to reset password.');
    return res.redirect('/dashboard');
  }
});

// POST /admin/users/:id/toggle-status — Enable/Disable account
router.post('/users/:id/toggle-status', async (req, res) => {
  const { id } = req.params;

  try {
    await query(
      `UPDATE users SET is_active = NOT is_active, updated_at = NOW() WHERE id = $1`,
      [id]
    );

    req.flash('success', 'User account status updated.');
    return res.redirect('/dashboard');
  } catch (err) {
    console.error('Toggle status error:', err);
    req.flash('error', 'Failed to update account status.');
    return res.redirect('/dashboard');
  }
});

// POST /admin/users/:id/toggle-membership — Manual Dues Override
router.post('/users/:id/toggle-membership', async (req, res) => {
  const { id } = req.params;

  try {
    await query(
      `UPDATE users 
       SET is_membership_active = NOT is_membership_active, updated_at = NOW() 
       WHERE id = $1`,
      [id]
    );

    req.flash('success', 'User membership active status updated.');
    return res.redirect('/dashboard');
  } catch (err) {
    console.error('Toggle membership error:', err);
    req.flash('error', 'Failed to update membership status.');
    return res.redirect('/dashboard');
  }
});

// =====================================================================
// 2. FIXTURES & MATCHDAY OPERATIONS
// =====================================================================

// POST /admin/fixtures — Schedule new match fixture with competition selection
router.post('/fixtures', async (req, res) => {
  const { opponent, match_date, venue, competition, custom_competition, is_home } = req.body;

  try {
    const homeAway = (is_home === 'on' || is_home === 'true' || is_home === true) ? 'home' : 'away';
    const finalCompetition = (competition === 'Other' && custom_competition) 
      ? custom_competition.trim() 
      : (competition || 'League Match');

    await query(
      `INSERT INTO fixtures (opponent, match_date, venue, competition, home_away, status)
       VALUES ($1, $2, $3, $4, $5, 'scheduled')`,
      [
        opponent.trim(), 
        match_date, 
        venue ? venue.trim() : null, 
        finalCompetition, 
        homeAway
      ]
    );

    req.flash('success', `Fixture vs ${opponent} (${finalCompetition}) scheduled successfully.`);
    return res.redirect('/dashboard');
  } catch (err) {
    console.error('Fixture scheduling error:', err);
    req.flash('error', 'Failed to schedule fixture.');
    return res.redirect('/dashboard');
  }
});

// POST /admin/fixtures/:id/edit — Update details (including competition type)
router.post('/fixtures/:id/edit', async (req, res) => {
  const { id } = req.params;
  const { opponent, match_date, venue, competition, custom_competition, home_away } = req.body;

  try {
    const finalCompetition = (competition === 'Other' && custom_competition) 
      ? custom_competition.trim() 
      : (competition || 'League Match');

    const { rowCount } = await query(
      `UPDATE fixtures 
       SET 
         opponent = $1, 
         match_date = $2, 
         venue = $3, 
         competition = $4, 
         home_away = $5, 
         updated_at = NOW()
       WHERE id = $6`,
      [
        opponent.trim(), 
        match_date, 
        venue ? venue.trim() : null, 
        finalCompetition, 
        home_away || 'home', 
        id
      ]
    );

    if (rowCount === 0) {
      req.flash('error', 'Fixture not found.');
    } else {
      req.flash('success', 'Fixture details updated successfully.');
    }
    return res.redirect('/dashboard');
  } catch (err) {
    console.error('Fixture update error:', err);
    req.flash('error', 'Failed to update fixture.');
    return res.redirect('/dashboard');
  }
});

// POST /admin/fixtures/log-result — Log result via dashboard modal form
router.post('/fixtures/log-result', validateMatchResult, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    errors.array().forEach((e) => req.flash('error', e.msg));
    return res.redirect('/dashboard');
  }

  const { fixture_id, our_score, opponent_score } = req.body;

  try {
    const { rowCount } = await query(
      `UPDATE fixtures 
       SET 
         our_score = $1, 
         opponent_score = $2, 
         status = 'finished', 
         updated_at = NOW() 
       WHERE id = $3`,
      [
        parseInt(our_score, 10),
        parseInt(opponent_score, 10),
        fixture_id,
      ]
    );

    if (rowCount === 0) {
      req.flash('error', 'Fixture not found or failed to update.');
    } else {
      req.flash('success', 'Match result logged successfully.');
    }

    return res.redirect('/dashboard');
  } catch (err) {
    console.error('Log match result error:', err);
    req.flash('error', 'Failed to log match result.');
    return res.redirect('/dashboard');
  }
});

// POST /admin/fixtures/:id/result — Log or Update match score directly
router.post('/fixtures/:id/result', async (req, res) => {
  const { id } = req.params;
  const { our_score, opponent_score } = req.body;

  try {
    await query(
      `UPDATE fixtures 
       SET our_score = $1, opponent_score = $2, status = 'finished', updated_at = NOW() 
       WHERE id = $3`,
      [parseInt(our_score, 10), parseInt(opponent_score, 10), id]
    );

    req.flash('success', 'Match result updated successfully.');
    return res.redirect('/dashboard');
  } catch (err) {
    console.error('Score update error:', err);
    req.flash('error', 'Failed to update score.');
    return res.redirect('/dashboard');
  }
});

// POST /admin/fixtures/:id/clear-result — Revert match back to scheduled status
router.post('/fixtures/:id/clear-result', async (req, res) => {
  const { id } = req.params;

  try {
    await query(
      `UPDATE fixtures 
       SET 
         our_score = 0, 
         opponent_score = 0, 
         status = 'scheduled', 
         updated_at = NOW() 
       WHERE id = $1`,
      [id]
    );

    req.flash('success', 'Match result reset and fixture reverted to scheduled status.');
    return res.redirect('/dashboard');
  } catch (err) {
    console.error('Clear result error:', err);
    req.flash('error', 'Failed to clear match result.');
    return res.redirect('/dashboard');
  }
});

// POST /admin/fixtures/:id/delete — Delete a fixture completely
router.post('/fixtures/:id/delete', async (req, res) => {
  const { id } = req.params;

  try {
    const { rowCount } = await query('DELETE FROM fixtures WHERE id = $1', [id]);

    if (rowCount === 0) {
      req.flash('error', 'Fixture not found.');
    } else {
      req.flash('success', 'Fixture deleted successfully.');
    }
    return res.redirect('/dashboard');
  } catch (err) {
    console.error('Fixture deletion error:', err);
    req.flash('error', 'Failed to delete fixture.');
    return res.redirect('/dashboard');
  }
});

// =====================================================================
// 3. REPORTS & CLUB ANALYTICS
// =====================================================================

// GET /admin/reports — Complete Financial & Operational Analytics View
router.get('/reports', async (req, res, next) => {
  try {
    const { rows: revenueByType } = await query(
      `SELECT payment_type, SUM(amount) AS total_amount, COUNT(*) as transaction_count 
       FROM payments 
       WHERE status = 'completed' 
       GROUP BY payment_type`
    );

    const { rows: financialTotals } = await query(
      `SELECT 
         COALESCE(SUM(amount) FILTER (WHERE status = 'completed'), 0) AS total_revenue,
         COALESCE(SUM(amount) FILTER (WHERE status = 'pending'), 0) AS pending_dues
       FROM payments`
    );

    const { rows: complianceStats } = await query(
      `SELECT 
         COUNT(*) FILTER (WHERE is_membership_active = TRUE) AS active_members,
         COUNT(*) FILTER (WHERE is_membership_active = FALSE) AS unpaid_members,
         COUNT(*) AS total_users
       FROM users`
    );

    const { rows: squadSummary } = await query(
      `SELECT r.name AS role_name, COUNT(u.id) AS count
       FROM users u
       JOIN roles r ON u.role_id = r.id
       GROUP BY r.name`
    );

    const { rows: matchAggregates } = await query(
      `SELECT 
         COUNT(*) AS played,
         COUNT(*) FILTER (WHERE our_score > opponent_score) AS wins,
         COUNT(*) FILTER (WHERE our_score = opponent_score) AS draws,
         COUNT(*) FILTER (WHERE our_score < opponent_score) AS losses,
         COALESCE(SUM(our_score), 0) AS gf,
         COALESCE(SUM(opponent_score), 0) AS ga
       FROM fixtures 
       WHERE status = 'finished'`
    );

    res.render('admin/reports', {
      title: 'Club Operational & Financial Reports',
      revenueByType,
      totalRevenue: financialTotals[0].total_revenue,
      pendingDues: financialTotals[0].pending_dues,
      activeMembersCount: complianceStats[0].active_members,
      pendingMembersCount: complianceStats[0].unpaid_members,
      complianceStats: complianceStats[0],
      squadSummary,
      matchStats: matchAggregates[0],
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;