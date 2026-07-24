require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const flash = require('connect-flash');
const expressLayouts = require('express-ejs-layouts');
const passport = require('./config/passport');
const { pool } = require('./config/db');
const { attachLocals, requirePasswordChange } = require('./middleware/auth');

const app = express();

// ---------------------------------------------------------------------
// View engine setup
// ---------------------------------------------------------------------
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');

// ---------------------------------------------------------------------
// Core middleware
// ---------------------------------------------------------------------
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    store: new pgSession({ pool, tableName: 'session' }),
    secret: process.env.SESSION_SECRET || 'kiminini-sportif-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());
app.use(flash());
app.use(attachLocals);

// Intercept un-rotated temporary passwords across all routes
app.use(requirePasswordChange);

// ---------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------
app.use('/', require('./routes/index'));
app.use('/', require('./routes/auth'));
app.use('/admin', require('./routes/admin'));
app.use('/', require('./routes/matches'));
app.use('/', require('./routes/payments'));
app.use('/', require('./routes/dashboard'));

// ---------------------------------------------------------------------
// 404 handler
// ---------------------------------------------------------------------
app.use((req, res) => {
  res.status(404).render('404', { title: 'Page Not Found', layout: 'layouts/main' });
});

// ---------------------------------------------------------------------
// Centralized error handler
// ---------------------------------------------------------------------
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).render('error', {
    title: 'Something Went Wrong',
    layout: 'layouts/main',
    message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred.' : err.message,
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Kiminini Sportif FC running on http://localhost:${PORT}`);
});

module.exports = app;