import {
  OTP_LENGTH,
  PASSWORD_MIN_LENGTH,
  emailError,
  isBadCredentialsError,
  isUnconfirmedEmailError,
  newPasswordError,
  normalizeEmail,
  sanitizeOtp,
} from '@/utils/auth/emailAuth';

describe('normalizeEmail', () => {
  it('trims the trailing space iOS autocomplete and paste both add', () => {
    expect(normalizeEmail('joe@example.com ')).toBe('joe@example.com');
    expect(normalizeEmail('  joe@example.com')).toBe('joe@example.com');
  });

  it('lowercases to match how Supabase stores the address', () => {
    expect(normalizeEmail('Joe@Example.COM')).toBe('joe@example.com');
  });

  it('is idempotent', () => {
    const once = normalizeEmail(' Joe@Example.com ');
    expect(normalizeEmail(once)).toBe(once);
  });
});

describe('emailError', () => {
  it('accepts ordinary addresses', () => {
    expect(emailError('joe@example.com')).toBeNull();
    expect(emailError('joe.spoelstra+fantasy@sub.example.co.uk')).toBeNull();
  });

  it('accepts an address that only needs normalizing', () => {
    expect(emailError('  Joe@Example.com ')).toBeNull();
  });

  it('rejects empty and obviously incomplete input', () => {
    expect(emailError('')).toBe('Enter your email address.');
    expect(emailError('   ')).toBe('Enter your email address.');
    expect(emailError('joe')).not.toBeNull();
    expect(emailError('joe@example')).not.toBeNull();
    expect(emailError('joe example.com')).not.toBeNull();
  });
});

describe('newPasswordError', () => {
  it('accepts a password at the minimum length', () => {
    expect(newPasswordError('a'.repeat(PASSWORD_MIN_LENGTH))).toBeNull();
  });

  it('rejects empty and short passwords', () => {
    expect(newPasswordError('')).toBe('Choose a password.');
    expect(newPasswordError('a'.repeat(PASSWORD_MIN_LENGTH - 1))).toContain(
      String(PASSWORD_MIN_LENGTH),
    );
  });
});

describe('sanitizeOtp', () => {
  it('strips the spaces a pasted code carries', () => {
    expect(sanitizeOtp('123 456')).toBe('123456');
    expect(sanitizeOtp(' 123456 ')).toBe('123456');
  });

  it('strips non-digits a mail client can inject', () => {
    expect(sanitizeOtp('123-456')).toBe('123456');
    expect(sanitizeOtp('​123456 ')).toBe('123456');
    expect(sanitizeOtp('abc123')).toBe('123');
  });

  it('leaves a clean code untouched', () => {
    expect(sanitizeOtp('123456')).toBe('123456');
    expect(sanitizeOtp('')).toBe('');
  });

  // The order matters, which is why the screens cap AFTER stripping rather
  // than via a TextInput `maxLength`: capping first eats real digits, and the
  // result would then never reach OTP_LENGTH so auto-submit would never fire.
  it('survives a spaced paste when the cap is applied after stripping', () => {
    const pasted = '1234 5678';
    expect(sanitizeOtp(pasted).slice(0, OTP_LENGTH)).toBe('12345678');
    expect(pasted.slice(0, OTP_LENGTH)).not.toBe('12345678');
  });

  it('caps an over-long paste at the code length', () => {
    expect(sanitizeOtp('1234567890').slice(0, OTP_LENGTH)).toHaveLength(OTP_LENGTH);
  });
});

describe('OTP_LENGTH', () => {
  // The hosted dashboard is the authority, not supabase/config.toml (which
  // only drives the local emulator and still reads 6). If someone changes the
  // dashboard's "Email OTP Length", this constant moves with it — otherwise
  // auto-submit fires at the wrong digit count and every code fails.
  it('matches the hosted project setting', () => {
    expect(OTP_LENGTH).toBe(8);
  });
});

describe('error classification', () => {
  it('detects an unconfirmed email by code or message', () => {
    expect(isUnconfirmedEmailError({ code: 'email_not_confirmed', message: 'x' })).toBe(true);
    expect(isUnconfirmedEmailError({ message: 'Email not confirmed' })).toBe(true);
    expect(isUnconfirmedEmailError({ message: 'Invalid login credentials' })).toBe(false);
  });

  it('detects bad credentials by code or message', () => {
    expect(isBadCredentialsError({ code: 'invalid_credentials', message: 'x' })).toBe(true);
    expect(isBadCredentialsError({ message: 'Invalid login credentials' })).toBe(true);
    expect(isBadCredentialsError({ message: 'Email not confirmed' })).toBe(false);
  });
});
