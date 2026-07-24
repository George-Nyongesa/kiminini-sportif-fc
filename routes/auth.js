const express = require('express');
const bcrypt = require('bcryptjs');
const passport = require('passport');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');

const router = express.Router();

const PAID_ROLES = ['player', 'coach', 'tm', 'treasurer'];

// ---------------------------------------------------------------------
// GET /register
// ---------------------------------------------------------------------
router.get('/register', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/dashboard');
  res.render('register', { title: 'Join the Club' });
});

// ---------------------------------------------------------------------
// POST /register  (local strategy sign-up + role selection)
// ---------------------------------------------------------------------
router.post(
  '/register',
  [
    body('fullName').trim().notEmpty().withMessage('Full name is required.'),
    body('email').isEmail().withMessage('Enter a valid email address.'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters.'),
    body('role').isIn(['fan', 'player', 'coach', 'tm', 'treasurer']).withMessage('Invalid role.'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      errors.array().forEach((e) => req.flash('error', e.msg));
      return res.redirect('/register');
    }

    const { fullName, email, password, role, phoneNumber } = req.body;

    try {
      const { rows: existing } = await query('SELECT id FROM users WHERE email = $1', [
        email.toLowerCase().trim(),
      ]);
      if (existing[0]) {
        req.flash('error', 'An account with that email already exists.');
        return res.redirect('/register');
      }

      const { rows: roleRow } = await query('SELECT id FROM roles WHERE name = $1', [role]);
      const passwordHash = await bcrypt.hash(password, 12);

      const { rows: created } = await query(
        `INSERT INTO users (full_name, email, password_hash, phone_number, role_id)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [fullName.trim(), email.toLowerCase().trim(), passwordHash, phoneNumber || null, roleRow[0].id]
      );

      // Team-side roles (Player/Coach/TM/Treasurer) also get a roster stub
      // so they show up for admin approval and squad management immediately.
      if (['player', 'coach', 'tm'].includes(role)) {
        await query('INSERT INTO players (user_id, is_public) VALUES ($1, FALSE)', [created[0].id]);
      }

      req.login({ id: created[0].id }, (err) => {
        if (err) {
          req.flash('error', 'Account created — please log in.');
          return res.redirect('/login');
        }
        if (PAID_ROLES.includes(role)) {
          req.flash('success', 'Welcome! Complete your membership payment to unlock team features.');
          return res.redirect('/pay-dues');
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
      return res.redirect('/dashboard');
    });
  })(req, res, next);
});

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
