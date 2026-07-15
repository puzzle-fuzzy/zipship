import { getThrownApiErrorCode } from '../../api/errors';

type Translate = (key: string) => string;

const authErrorKeys: Record<string, string> = {
  INVALID_CREDENTIALS: 'auth.invalidCredentials',
  ACCOUNT_DISABLED: 'auth.accountDisabled',
  DUPLICATE_EMAIL: 'auth.duplicateEmail',
  INVALID_EMAIL: 'auth.invalidEmail',
  INVALID_DISPLAY_NAME: 'auth.invalidName',
  INVALID_PASSWORD: 'auth.passwordPolicy',
  INVALID_PASSWORD_RESET_TOKEN: 'auth.resetInvalid',
  ANONYMOUS_RATE_LIMITED: 'auth.tooManyAttempts',
};

export function authErrorMessage(error: unknown, t: Translate, fallbackKey: string) {
  const code = getThrownApiErrorCode(error);
  return t((code && authErrorKeys[code]) || fallbackKey);
}
