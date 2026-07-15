import { beforeEach, describe, expect, it } from 'vitest';
import {
  consumePasswordResetToken,
  resetPasswordResetTokenForTests,
} from '../src/features/auth/resetToken';

beforeEach(() => {
  resetPasswordResetTokenForTests();
  window.history.replaceState({}, '', '/reset-password');
  sessionStorage.clear();
  localStorage.clear();
});

describe('password reset fragment credential', () => {
  it('consumes the token once and immediately scrubs browser history', () => {
    window.history.replaceState({}, '', '/reset-password?source=email#token=secret%20token');

    expect(consumePasswordResetToken()).toBe('secret token');
    expect(window.location.pathname).toBe('/reset-password');
    expect(window.location.search).toBe('?source=email');
    expect(window.location.hash).toBe('');
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it('keeps the token in document memory across a Strict Mode remount', () => {
    window.history.replaceState({}, '', '/reset-password#token=secret-token');
    expect(consumePasswordResetToken()).toBe('secret-token');
    expect(consumePasswordResetToken()).toBe('secret-token');
  });

  it('accepts a newly navigated fragment after an earlier missing-token view', () => {
    expect(consumePasswordResetToken()).toBeNull();
    window.history.replaceState({}, '', '/reset-password#token=later-token');
    expect(consumePasswordResetToken()).toBe('later-token');
    expect(window.location.hash).toBe('');
  });

  it('fails closed when the fragment credential is absent', () => {
    expect(consumePasswordResetToken()).toBeNull();
  });
});
