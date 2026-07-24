/**
 * RBAC middleware. Attach in route definitions, e.g.:
 *   router.get('/dashboard', requireAuth, requireRole('treasurer', 'admin'), handler)
 */

/** Blocks unauthenticated requests. */
function requireAuth(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) return next();
  req.flash('error', 'Please log in to continue.');
  return res.redirect('/login');
}

/**
 * Restricts access to one or more roles. Admins always pass, since they
 * hold full CMS/user-management authority regardless of the route's roles.
 *   requireRole('treasurer')
 *   requireRole('player', 'coach', 'tm')
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      req.flash('error', 'Please log in to continue.');
      return res.redirect('/login');
    }
    if (req.user.role_name === 'admin' || allowedRoles.includes(req.user.role_name)) {
      return next();
    }
    req.flash('error', "You don't have permission to view that page.");
    return res.redirect('/dashboard');
  };
}

/**
 * Restricts access to users with an active paid membership
 * (Players, Coaches, Team Managers — used for internal training/tactics areas).
 */
function requireActiveMembership(req, res, next) {
  if (!req.user) {
    req.flash('error', 'Please log in to continue.');
    return res.redirect('/login');
  }
  if (req.user.role_name === 'admin') return next();
  if (req.user.is_membership_active) return next();

  req.flash('error', 'Your membership dues are not up to date. Please pay to unlock this area.');
  return res.redirect('/pay-dues');
}

/** Makes req.user and flash messages available to every EJS view. */
function attachLocals(req, res, next) {
  res.locals.currentUser = req.user || null;
  res.locals.messages = {
    success: req.flash('success'),
    error: req.flash('error'),
  };
  next();
}

module.exports = { requireAuth, requireRole, requireActiveMembership, attachLocals };
