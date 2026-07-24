const express = require('express');
const bcrypt = require('bcryptjs');
const passport = require('passport');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ---------------------------------------------------------------------
// GET /register
// ---------------------------------------------------------------------
router.get('/register', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/dashboard');
  res.render('register', { title: 'Join the Club' });
});

// ---------------------------------------------------------------------
// POST /register (Public self-registration — Fan role only)
// ---------------------------------------------------------------------
router.post(
  '/register',
  [
    body('fullName').trim().notEmpty().withMessage('Full name is required.'),
    body('email').isEmail().withMessage('Enter a valid email address.'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      errors.array().forEach((e) => req.flash('error', e.msg));
      return res.redirect('/register');
    }

    const { fullName, email, password, phoneNumber } = req.body;

    try {
      const { rows: existing } = await query('SELECT id FROM users WHERE email = $1', [
        email.toLowerCase().trim(),
      ]);

      if (existing[0]) {
        req.flash('error', 'An account with that email already exists.');
        return res.redirect('/register');
      }

      // Fetch the 'fan' role ID explicitly
      const { rows: roleRow } = await query('SELECT id FROM roles WHERE name = $1', ['fan']);
      if (!roleRow.length) {
        throw new Error('Fan role definition missing in database.');
      }

      const passwordHash = await bcrypt.hash(password, 12);

      // Public registrants default to fan role and active status
      const { rows: created } = await query(
        `INSERT INTO users (full_name, email, password_hash, phone_number, role_id, is_membership_active)
         VALUES ($1, $2, $3, $4, $5, TRUE) 
         RETURNING id, email, full_name`,
        [fullName.trim(), email.toLowerCase().trim(), passwordHash, phoneNumber || null, roleRow[0].id]
      );

      req.login({ id: created[0].id }, (err) => {
        if (err) {
          req.flash('error', 'Account created — please log in.');
          return res.redirect('/login');
        }
        req.flash('success', 'Welcome to Kiminini Sportif FC!');
        return res.redirect('/dashboard');
      });
    } catch (err) {
      console.error('Registration error:', err);
      req.flash('error', 'Something went wrong creating your account. Please try again.');
      res.redirect('/register');
    }
  }
);

// ---------------------------------------------------------------------
// GET /login
// ---------------------------------------------------------------------
router.get('/login', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/dashboard');
  res.render('login', { title: 'Log In' });
});

// ---------------------------------------------------------------------
// POST /login
// ---------------------------------------------------------------------
router.post('/login', (req, res, next) => {
  passport.authenticate('local', (err, user, info) => {
    if (err) return next(err);
    if (!user) {
      req.flash('error', info?.message || 'Invalid email or password.');
      return res.redirect('/login');
    }
    req.logIn(user, (loginErr) => {
      if (loginErr) return next(loginErr);
      
      // Password change interception handled by requirePasswordChange middleware
      return res.redirect('/dashboard');
    });
  })(req, res, next);
});

// ---------------------------------------------------------------------
// GET /change-password
// Render view for updating temporary or existing passwords
// ---------------------------------------------------------------------
router.get('/change-password', requireAuth, (req, res) => {
  res.render('change-password', { title: 'Update Password' });
});

// ---------------------------------------------------------------------
// POST /change-password
// Process password updates for provisioned accounts
// ---------------------------------------------------------------------
router.post(
  '/change-password',
  requireAuth,
  [
    body('newPassword').isLength({ min: 8 }).withMessage('Password must be at least 8 characters long.'),
    body('confirmPassword').custom((value, { req }) => {
      if (value !== req.body.newPassword) {
        throw new Error('Passwords do not match.');
      }
      return true;
    }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      errors.array().forEach((e) => req.flash('error', e.msg));
      return res.redirect('/change-password');
    }

    const { newPassword } = req.body;

    try {
      const hashedPassword = await bcrypt.hash(newPassword, 12);

      await query(
        `UPDATE users 
         SET password_hash = $1, must_change_password = FALSE 
         WHERE id = $2`,
        [hashedPassword, req.user.id]
      );

      // Update current session state flag
      if (req.user) req.user.must_change_password = false;

      req.flash('success', 'Your password has been successfully updated.');
      return res.redirect('/dashboard');
    } catch (err) {
      console.error('Password Update Error:', err);
      req.flash('error', 'Failed to update password. Please try again.');
      return res.redirect('/change-password');
    }
  }
);

// ---------------------------------------------------------------------
// Google OAuth
// ---------------------------------------------------------------------
router.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get(
  '/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/login', failureFlash: true }),
  (req, res) => res.redirect('/dashboard')
);

// ---------------------------------------------------------------------
// Facebook OAuth
// ---------------------------------------------------------------------
router.get('/auth/facebook', passport.authenticate('facebook', { scope: ['email'] }));

router.get(
  '/auth/facebook/callback',
  passport.authenticate('facebook', { failureRedirect: '/login', failureFlash: true }),
  (req, res) => res.redirect('/dashboard')
);

// ---------------------------------------------------------------------
// GET /logout
// ---------------------------------------------------------------------
router.get('/logout', (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.flash('success', 'You have been logged out.');
    res.redirect('/');
  });
});

module.exports = router;