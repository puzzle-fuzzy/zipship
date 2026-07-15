import { describe, expect, test } from 'vitest';
import {
  API_ERROR_MESSAGES,
  ApiClientError,
  getApiErrorCode,
  getThrownApiErrorCode,
  mapApiError,
} from '../src/api/errors';

describe('OpenAPI error mapping', () => {
  test('extracts stable Rust API codes from response bodies', () => {
    expect(getApiErrorCode({ error: { code: 'UNAUTHENTICATED' } })).toBe('UNAUTHENTICATED');
    expect(getApiErrorCode({ error: 'plain text' })).toBeUndefined();
    expect(getApiErrorCode(undefined)).toBeUndefined();
  });

  test('keeps the stable code on the thrown client error', () => {
    const error = mapApiError(
      { error: { code: 'INVALID_CREDENTIALS' } },
      { codes: { INVALID_CREDENTIALS: 'bad credentials' }, fallback: 'failed' },
    );
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error.message).toBe('bad credentials');
    expect(getThrownApiErrorCode(error)).toBe('INVALID_CREDENTIALS');
  });

  test('uses the fallback for missing and unknown codes', () => {
    expect(mapApiError({ error: { code: 'UNKNOWN' } }, { codes: {}, fallback: 'failed' }).message).toBe('failed');
    expect(mapApiError({}, { codes: {}, fallback: 'failed' }).message).toBe('failed');
  });

  test('covers the Rust codes used by Console stores', () => {
    for (const code of [
      'UNAUTHENTICATED',
      'INVALID_CSRF_TOKEN',
      'FORBIDDEN',
      'INVALID_JSON',
      'NOT_FOUND',
      'INVALID_CREDENTIALS',
      'ACCOUNT_DISABLED',
      'DUPLICATE_EMAIL',
      'INVALID_EMAIL',
      'INVALID_DISPLAY_NAME',
      'INVALID_PASSWORD',
      'INVALID_PASSWORD_RESET_TOKEN',
      'ANONYMOUS_RATE_LIMITED',
      'DUPLICATE_PROJECT_SLUG',
      'PROJECT_NOT_FOUND',
      'RELEASE_NOT_FOUND',
      'ALREADY_MEMBER',
      'INVITATION_ALREADY_PENDING',
      'LAST_OWNER',
    ]) {
      expect(API_ERROR_MESSAGES[code]).toBeTruthy();
    }
  });
});
