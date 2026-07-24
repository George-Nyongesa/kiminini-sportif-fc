/**
 * Passport strategy configuration: Local, Google OAuth2, Facebook OAuth2.
 * Requires config/db.js and bcryptjs.
 */
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const FacebookStrategy = require('passport-facebook').Strategy;
const bcrypt = require('bcryptjs');
const { query } = require('./db');

// ---------------------------------------------------------------------
// Helper: Retrieve full user record with role name attached
// ---------------------------------------------------------------------
async function getUserWithRole(userId) {
  const { rows } = await query(
    `SELECT u.*, r.name AS role_name
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1`,
    [userId]
  );
  return rows[0] || null;
}

// ---------------------------------------------------------------------
// Local Strategy (email + password)
// ---------------------------------------------------------------------
passport.use(
  new LocalStrategy({ usernameField: 'email' }, async (email, password, done) => {
    try {
      const { rows } = await query(
        `SELECT u.*, r.name AS role_name 
         FROM users u 
         JOIN roles r ON r.id = u.role_id 
         WHERE u.email = $1`,
        [email.toLowerCase().trim()]
      );
      const user = rows[0];

      if (!user) {
        return done(null, false, { message: 'No account found with that email.' });
      }
      if (!user.password_hash) {
        return done(null, false, {
          message: 'This account uses social sign-in. Try Google or Facebook.',
        });
      }

      const isMatch = await bcrypt.compare(password, user.password_hash);
      if (!isMatch) {
        return done(null, false, { message: 'Incorrect password.' });
      }
      if (!user.is_active) {
        return done(null, false, { message: 'This account has been deactivated.' });
      }

      return done(null, user);
    } catch (err) {
      return done(err);
    }
  })
);

// ---------------------------------------------------------------------
// Google OAuth 2.0 Strategy
// ---------------------------------------------------------------------
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value?.toLowerCase();
        const { rows: byGoogleId } = await query('SELECT id FROM users WHERE google_id = $1', [
          profile.id,
        ]);

        if (byGoogleId[0]) {
          const user = await getUserWithRole(byGoogleId[0].id);
          return done(null, user);
        }

        // Link to an existing email-based account, or create a new fan account.
        if (email) {
          const { rows: byEmail } = await query('SELECT id FROM users WHERE email = $1', [email]);
          if (byEmail[0]) {
            await query('UPDATE users SET google_id = $1 WHERE id = $2', [
              profile.id,
              byEmail[0].id,
            ]);
            const user = await getUserWithRole(byEmail[0].id);
            return done(null, user);
          }
        }

        const { rows: fanRole } = await query("SELECT id FROM roles WHERE name = 'fan'");
        const { rows: created } = await query(
          `INSERT INTO users (full_name, email, google_id, avatar_url, role_id, is_membership_active)
           VALUES ($1, $2, $3, $4, $5, TRUE) RETURNING id`,
          [
            profile.displayName || 'Kiminini Fan',
            email || `google_${profile.id}@no-email.kimininisportif.fc`,
            profile.id,
            profile.photos?.[0]?.value || '/images/default-avatar.png',
            fanRole[0].id,
          ]
        );

        const newUser = await getUserWithRole(created[0].id);
        return done(null, newUser);
      } catch (err) {
        return done(err);
      }
    }
  )
);

// ---------------------------------------------------------------------
// Facebook OAuth 2.0 Strategy
// ---------------------------------------------------------------------
passport.use(
  new FacebookStrategy(
    {
      clientID: process.env.FACEBOOK_APP_ID,
      clientSecret: process.env.FACEBOOK_APP_SECRET,
      callbackURL: process.env.FACEBOOK_CALLBACK_URL || '/auth/facebook/callback',
      profileFields: ['id', 'displayName', 'photos', 'email'],
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value?.toLowerCase();
        const { rows: byFbId } = await query('SELECT id FROM users WHERE facebook_id = $1', [
          profile.id,
        ]);

        if (byFbId[0]) {
          const user = await getUserWithRole(byFbId[0].id);
          return done(null, user);
        }

        if (email) {
          const { rows: byEmail } = await query('SELECT id FROM users WHERE email = $1', [email]);
          if (byEmail[0]) {
            await query('UPDATE users SET facebook_id = $1 WHERE id = $2', [
              profile.id,
              byEmail[0].id,
            ]);
            const user = await getUserWithRole(byEmail[0].id);
            return done(null, user);
          }
        }

        const { rows: fanRole } = await query("SELECT id FROM roles WHERE name = 'fan'");
        const { rows: created } = await query(
          `INSERT INTO users (full_name, email, facebook_id, avatar_url, role_id, is_membership_active)
           VALUES ($1, $2, $3, $4, $5, TRUE) RETURNING id`,
          [
            profile.displayName || 'Kiminini Fan',
            email || `facebook_${profile.id}@no-email.kimininisportif.fc`,
            profile.id,
            profile.photos?.[0]?.value || '/images/default-avatar.png',
            fanRole[0].id,
          ]
        );

        const newUser = await getUserWithRole(created[0].id);
        return done(null, newUser);
      } catch (err) {
        return done(err);
      }
    }
  )
);

// ---------------------------------------------------------------------
// Session (de)serialization
// ---------------------------------------------------------------------
passport.serializeUser((user, done) => done(null, user.id));

passport.deserializeUser(async (id, done) => {
  try {
    const user = await getUserWithRole(id);
    done(null, user || false);
  } catch (err) {
    done(err);
  }
});

module.exports = passport;