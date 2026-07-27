const express = require('express');
const bcrypt = require('bcryptjs');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const { uploadAvatar } = require('../middleware/upload');

const router = express.Router();

router.use(requireAuth);

// GET /profile — User Profile Page
router.get('/profile', async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT u.id, u.full_name, u.email, u.phone_number, u.avatar_url, r.name AS role_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE u.id = $1`,
      [req.user.id]
    );

    res.render('profile', {
      title: 'My Profile',
      userProfile: rows[0],
      currentUser: req.user,
    });
  } catch (err) {
    next(err);
  }
});

// POST /profile — Update Profile Details & Avatar
router.post('/profile', uploadAvatar.single('avatar'), async (req, res) => {
  const { full_name, phone_number } = req.body;
  const userId = req.user.id;

  try {
    let avatarUrl = null;
    if (req.file) {
      avatarUrl = `/uploads/avatars/${req.file.filename}`;
    }

    if (avatarUrl) {
      await query(
        `UPDATE users 
         SET full_name = $1, phone_number = $2, avatar_url = $3, updated_at = NOW() 
         WHERE id = $4`,
        [full_name.trim(), phone_number ? phone_number.trim() : null, avatarUrl, userId]
      );
    } else {
      await query(
        `UPDATE users 
         SET full_name = $1, phone_number = $2, updated_at = NOW() 
         WHERE id = $3`,
        [full_name.trim(), phone_number ? phone_number.trim() : null, userId]
      );
    }

    req.flash('success', 'Profile details updated successfully.');
    res.redirect('/profile');
  } catch (err) {
    console.error('Profile update error:', err);
    req.flash('error', 'Failed to update profile details.');
    res.redirect('/profile');
  }
});

// POST /profile/change-password — User Self-Service Password Reset
router.post(
  '/profile/change-password',
  [
    body('current_password').notEmpty().withMessage('Current password is required.'),
    body('new_password')
      .isLength({ min: 8 })
      .withMessage('New password must be at least 8 characters long.'),
    body('confirm_password').custom((value, { req }) => {
      if (value !== req.body.new_password) {
        throw new Error('Password confirmation does not match new password.');
      }
      return true;
    }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      errors.array().forEach((e) => req.flash('error', e.msg));
      return res.redirect('/profile');
    }

    const { current_password, new_password } = req.body;
    const userId = req.user.id;

    try {
      const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [userId]);
      const valid = await bcrypt.compare(current_password, rows[0].password_hash);

      if (!valid) {
        req.flash('error', 'Incorrect current password.');
        return res.redirect('/profile');
      }

      const newHash = await bcrypt.hash(new_password, 12);
      await query(
        `UPDATE users 
         SET password_hash = $1, must_change_password = FALSE, updated_at = NOW() 
         WHERE id = $2`,
        [newHash, userId]
      );

      req.flash('success', 'Password updated successfully.');
      res.redirect('/profile');
    } catch (err) {
      console.error('Password change error:', err);
      req.flash('error', 'Failed to change password.');
      res.redirect('/profile');
    }
  }
);

module.exports = router;