const { body } = require('express-validator');

const validateMatchResult = [
  body('fixture_id')
    .notEmpty()
    .withMessage('A valid fixture selection is required.')
    .isInt({ min: 1 })
    .withMessage('Fixture ID must be an integer.'),

  body('our_score')
    .notEmpty()
    .withMessage('Kiminini score is required.')
    .isInt({ min: 0 })
    .withMessage('Score cannot be negative.'),

  body('opponent_score')
    .notEmpty()
    .withMessage('Opponent score is required.')
    .isInt({ min: 0 })
    .withMessage('Score cannot be negative.'),

  body('scorers')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 255 })
    .withMessage('Scorers list must be under 255 characters.'),

  body('match_notes')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Match notes must be under 1000 characters.')
];

const validatePOTMVote = [
  body('fixture_id')
    .notEmpty()
    .isInt({ min: 1 })
    .withMessage('Valid fixture selection required.'),
  body('player_id')
    .notEmpty()
    .isInt({ min: 1 })
    .withMessage('Valid player selection required.')
];

module.exports = {
  validateMatchResult,
  validatePOTMVote
};