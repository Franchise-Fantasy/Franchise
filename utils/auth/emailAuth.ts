/**
 * Pure email/password auth helpers shared by the two auth screens
 * (components/account/Auth.tsx and its Auth.web.tsx twin).
 *
 * Those files carry a standing DRIFT WARNING because they duplicate the
 * sign-in / sign-up / OTP flow. Everything in here is the part of that
 * logic that can be shared outright — no React, no Supabase, no RN — so it
 * cannot drift and is unit-testable on its own.
 */

/**
 * Mirrors `minimum_password_length` in supabase/config.toml. Surfaced in the
 * sign-up field's helper text so the rule is stated before the server
 * rejects the submit.
 */
export const PASSWORD_MIN_LENGTH = 6;

/**
 * Supabase lowercases email addresses server-side, so an address typed as
 * "Bob@x.com" signs in as "bob@x.com". Normalizing client-side keeps the
 * address we *display* (on the verification screen) identical to the one the
 * account actually uses, and drops the trailing space that iOS autocomplete
 * and paste both like to add — which the server rejects as an invalid format.
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

// Deliberately loose: this only catches obvious typos before we spend a
// network round-trip. The server does the real validation, and an
// over-strict pattern rejects legitimate addresses.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Field-level error for an email input, or null when it looks usable. */
export function emailError(raw: string): string | null {
  const email = normalizeEmail(raw);
  if (!email) return 'Enter your email address.';
  if (!EMAIL_PATTERN.test(email)) return 'That email address looks incomplete.';
  return null;
}

/**
 * Field-level error for a NEW password. Only apply this on sign-up — an
 * existing account may predate the current policy and must still be able to
 * sign in with the password it actually has.
 */
export function newPasswordError(password: string): string | null {
  if (!password) return 'Choose a password.';
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  return null;
}

/**
 * Length of the emailed verification code, and the point at which the
 * verification screen submits on its own.
 *
 * The hosted dashboard is the authority here (Auth → Providers → Email →
 * "Email OTP Length"), NOT supabase/config.toml — that file only governs the
 * local emulator and still reads 6. Confirmed 8 on 2026-08-04.
 *
 * Never express this as a TextInput `maxLength`: that truncates a pasted
 * "1234 5678" to "1234 567" *before* sanitizeOtp gets to strip the space.
 * Strip first, then cap.
 */
export const OTP_LENGTH = 8;

/**
 * Codes are copied out of an email, so they arrive with stray spaces and the
 * occasional zero-width character from the mail client's formatting.
 * `.trim()` alone only cleans the ends — a pasted "123 456" stays broken.
 */
export function sanitizeOtp(raw: string): string {
  return raw.replace(/\D/g, '');
}

/**
 * Signing in before confirming the email fails with a distinct code. Both
 * screens use it to send a fresh code and drop into the verification step
 * instead of dead-ending on the error.
 */
export function isUnconfirmedEmailError(error: { code?: string; message: string }): boolean {
  return (
    error.code === 'email_not_confirmed'
    || /email\s+not\s+confirmed/i.test(error.message)
  );
}

/** A wrong password / unknown account, which reads better under the field. */
export function isBadCredentialsError(error: { code?: string; message: string }): boolean {
  return (
    error.code === 'invalid_credentials'
    || /invalid\s+login\s+credentials/i.test(error.message)
  );
}
