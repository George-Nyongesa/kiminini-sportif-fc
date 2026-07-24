const express = require('express');
const { query } = require('../config/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();

const MEMBERSHIP_FEE_KES = 500; // adjust to the club's actual due amount

/**
 * NOTE — Daraja (Safaricom M-Pesa) integration is stubbed as `initiateStkPush`.
 * Wire this to the real Daraja `/mpesa/stkpush/v1/processrequest` endpoint,
 * using an OAuth token from `/oauth/v1/generate` and the Base64 password of
 * `Shortcode + Passkey + Timestamp`. Kept as a stub here so this scaffold
 * runs without live Safaricom credentials.
 */
async function initiateStkPush({ phoneNumber, amount, accountReference }) {
  // Replace with a real `fetch()`/axios call to Safaricom's Daraja API.
  return {
    MerchantRequestID: `MR-${Date.now()}`,
    CheckoutRequestID: `ws_CO_${Date.now()}`,
    ResponseCode: '0',
    ResponseDescription: 'Success. Request accepted for processing',
    CustomerMessage: 'Success. Request accepted for processing',
  };
}

// ---------------------------------------------------------------------
// POST /api/payments/stk-push
// Body: { phoneNumber, paymentType }
// Triggers the M-Pesa payment prompt on the member's phone.
// ---------------------------------------------------------------------
router.post('/api/payments/stk-push', requireAuth, async (req, res) => {
  const { phoneNumber, paymentType } = req.body;

  if (!phoneNumber || !/^(2547|2541)\d{8}$/.test(phoneNumber)) {
    return res
      .status(400)
      .json({ ok: false, error: 'Enter a valid Safaricom number in 2547XXXXXXXX format.' });
  }

  try {
    const stk = await initiateStkPush({
      phoneNumber,
      amount: MEMBERSHIP_FEE_KES,
      accountReference: `KSFC-${req.user.id}`,
    });

    await query(
      `INSERT INTO payments (user_id, amount, phone_number, payment_type, status, checkout_request_id)
       VALUES ($1, $2, $3, $4, 'pending', $5)`,
      [
        req.user.id,
        MEMBERSHIP_FEE_KES,
        phoneNumber,
        paymentType || 'membership_due',
        stk.CheckoutRequestID,
      ]
    );

    res.json({
      ok: true,
      message: 'Check your phone and enter your M-Pesa PIN to complete payment.',
      checkoutRequestId: stk.CheckoutRequestID,
    });
  } catch (err) {
    console.error('STK push error:', err);
    res.status(500).json({ ok: false, error: 'Could not start the payment. Please try again.' });
  }
});

// ---------------------------------------------------------------------
// POST /api/payments/callback  (Safaricom Daraja webhook — no auth)
// Marks the payment complete and activates membership.
// ---------------------------------------------------------------------
router.post('/api/payments/callback', async (req, res) => {
  // Daraja always expects a 200 response, even on business-logic failure,
  // or it will retry the webhook repeatedly.
  try {
    const stkCallback = req.body?.Body?.stkCallback;
    if (!stkCallback) return res.status(200).json({ ResultCode: 0, ResultDesc: 'Ignored' });

    const { CheckoutRequestID, ResultCode, CallbackMetadata } = stkCallback;

    const client = await require('../config/db').pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: paymentRows } = await client.query(
        'SELECT * FROM payments WHERE checkout_request_id = $1 FOR UPDATE',
        [CheckoutRequestID]
      );
      const payment = paymentRows[0];

      if (!payment) {
        await client.query('ROLLBACK');
        return res.status(200).json({ ResultCode: 0, ResultDesc: 'No matching payment' });
      }

      if (ResultCode === 0) {
        const items = CallbackMetadata?.Item || [];
        const receipt = items.find((i) => i.Name === 'MpesaReceiptNumber')?.Value || null;

        await client.query(
          `UPDATE payments SET status = 'completed', mpesa_receipt_number = $1,
             raw_callback_payload = $2 WHERE id = $3`,
          [receipt, JSON.stringify(req.body), payment.id]
        );
        await client.query('UPDATE users SET is_membership_active = TRUE WHERE id = $1', [
          payment.user_id,
        ]);
      } else {
        await client.query(
          `UPDATE payments SET status = 'failed', raw_callback_payload = $1 WHERE id = $2`,
          [JSON.stringify(req.body), payment.id]
        );
      }

      await client.query('COMMIT');
    } catch (innerErr) {
      await client.query('ROLLBACK');
      throw innerErr;
    } finally {
      client.release();
    }

    res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });
  } catch (err) {
    console.error('M-Pesa callback error:', err);
    // Still 200 — Daraja retries aggressively on non-200 responses.
    res.status(200).json({ ResultCode: 1, ResultDesc: 'Server error, logged internally' });
  }
});

// ---------------------------------------------------------------------
// GET /api/payments/status/:checkoutRequestId  — poll payment result
// ---------------------------------------------------------------------
router.get('/api/payments/status/:checkoutRequestId', requireAuth, async (req, res, next) => {
  try {
    const { rows } = await query(
      'SELECT status, mpesa_receipt_number FROM payments WHERE checkout_request_id = $1 AND user_id = $2',
      [req.params.checkoutRequestId, req.user.id]
    );
    res.json({ ok: true, payment: rows[0] || null });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------
// GET /reports/financial  — Treasurer-only printable dashboard summary
// ---------------------------------------------------------------------
router.get('/reports/financial', requireAuth, requireRole('treasurer'), async (req, res, next) => {
  try {
    const { rows: payments } = await query(
      `SELECT p.*, u.full_name, u.email FROM payments p
       JOIN users u ON u.id = p.user_id
       ORDER BY p.created_at DESC LIMIT 200`
    );
    const { rows: summary } = await query(
      `SELECT status, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
       FROM payments GROUP BY status`
    );
    res.render('reports/financial', {
      title: 'Financial Report',
      layout: false, // printable views render standalone, without the site chrome
      payments,
      summary,
      generatedAt: new Date(),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
