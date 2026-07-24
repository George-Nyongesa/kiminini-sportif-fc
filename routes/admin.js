const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { requireAuth, requirePasswordChange, requireRole } = require('../middleware/auth');

const router = express.Router();

// Apply auth, password check, and admin role restrictions to all admin routes
router.use(requireAuth, requirePasswordChange, requireRole('admin'));

// ---------------------------------------------------------------------
// POST /admin/users — Provision a new user account
// ---------------------------------------------------------------------
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
      // 1. Check for existing user
      const { rows: existing } = await query('SELECT id FROM users WHERE email = $1', [
        email.toLowerCase().trim(),
      ]);

      if (existing[0]) {
        req.flash('error', 'A user with that email address already exists.');
        return res.redirect('/dashboard');
      }

      // 2. Fetch role details to verify and check membership necessity
      const { rows: roleRow } = await query('SELECT id, name FROM roles WHERE id = $1', [role_id]);
      if (!roleRow.length) {
        req.flash('error', 'Selected role is invalid.');
        return res.redirect('/dashboard');
      }

      const roleName = roleRow[0].name;

      // 3. Hash temporary password
      const passwordHash = await bcrypt.hash(temp_password, 12);

      // Non-fan official team accounts require active membership flag enabled by default upon provisioning
      const isMembershipActive = roleName !== 'fan';

      // 4. Insert provisioned user with must_change_password set to TRUE
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

      // 5. Create roster profile stub for team roles
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

// ---------------------------------------------------------------------
// POST /admin/users/:id/reset-password
// Issue a temporary password reset for an existing user
// ---------------------------------------------------------------------
router.post(
  '/users/:id/reset-password',
  async (req, res) => {
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
  }
);

// ---------------------------------------------------------------------
// POST /admin/users/:id/toggle-status
// Toggle user active status (Enable/Disable account)
// ---------------------------------------------------------------------
router.post('/users/:id/toggle-status', async (req, res, next) => {
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

module.exports = router;