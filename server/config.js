/* ============================================================
   System rules – change the numbers here, not in the code.
   ============================================================ */

module.exports = {
  /* Module 1 – accounts */
  STUDENT_DOMAIN: '@student.tarc.edu.my',
  // Admin registration secret. Set ADMIN_SECRET_CODE in the environment for a
  // real deployment; the default below is for the demo only.
  ADMIN_SECRET_CODE: process.env.ADMIN_SECRET_CODE || 'CHH-ADMIN-2026',
  ADMIN_CODE_MAX_ATTEMPTS: 5,
  ADMIN_CODE_LOCK_MINUTES: 15,

  /* Trust Points */
  TRUST_START: 100,
  TRUST_FLAG_BELOW: 50,              // accounts below this are flagged for admin review
  TRUST_PENALTY: {                    // applied to the borrower for confirmed violations
    late_return: 10,
    damage: 20,
    lost: 40,
    not_returned: 50,
  },
  TRUST_BONUS_ON_TIME: 2,             // completing a loan on time, without a dispute
  TRUST_RATING_BONUS: { 5: 3, 4: 1 }, // stars received → bonus points
  LOW_RATING_WARNING_AT: 2,           // ratings at or below this trigger a reputation warning

  /* Module 2 – listings */
  MAX_DAILY_RATE: 200,                // RM
  MAX_DEPOSIT: 2000,                  // RM
  MAX_PHOTOS: 5,

  /* Module 3 – bookings & payment */
  MAX_LOAN_DAYS: 14,
  MAX_ACTIVE_BOOKINGS: 3,
  MAX_PENDING_REQUESTS: 5,
  MAX_START_AHEAD_DAYS: 30,
  PAYMENT_WINDOW_MINUTES: 30,         // unpaid bookings are cancelled after this

  /* Module 4 – handover */
  PIN_MAX_ATTEMPTS: 5,
  PIN_LOCK_MINUTES: 15,
  AUTO_VOID_AFTER_DAYS: 2,            // confirmed but never handed over → void + refund
  AUTO_COMPLETE_INSPECTION_DAYS: 3,   // lender never inspects the return → refund deposit

  /* Module 6 – reviews */
  REVIEW_EDIT_DAYS: 7,
};
