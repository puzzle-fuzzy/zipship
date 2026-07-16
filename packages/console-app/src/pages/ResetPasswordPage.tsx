import { AlertCircle, CircleCheck, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Alert, AlertDescription, AlertTitle } from '../components/primitives/alert';
import { Button, buttonVariants } from '../components/primitives/button';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '../components/primitives/field';
import { Input } from '../components/primitives/input';
import { AuthShell } from '../features/auth/AuthShell';
import { authErrorMessage } from '../features/auth/authErrorMessage';
import {
  clearPasswordResetToken,
  usePasswordResetToken,
} from '../features/auth/resetToken';
import { useTranslation } from '../i18n';
import { passwordSchema } from '../lib/validation';
import { useAuthStore } from '../stores/authStore';

type PasswordErrors = Partial<Record<'password' | 'confirmation', string>>;

export function ResetPasswordPage() {
  const { t } = useTranslation();
  const confirmPasswordReset = useAuthStore((state) => state.confirmPasswordReset);
  const token = usePasswordResetToken();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [fieldErrors, setFieldErrors] = useState<PasswordErrors>({});
  const [requestError, setRequestError] = useState('');
  const [loading, setLoading] = useState(false);
  const [complete, setComplete] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setRequestError('');
    const nextErrors: PasswordErrors = {};
    const parsedPassword = passwordSchema.safeParse(password);
    if (!parsedPassword.success) nextErrors.password = t('auth.passwordPolicy');
    if (password !== confirmation) nextErrors.confirmation = t('auth.passwordMismatch');
    setFieldErrors(nextErrors);
    if (!token || !parsedPassword.success || Object.keys(nextErrors).length > 0) return;

    setLoading(true);
    try {
      await confirmPasswordReset(token, parsedPassword.data);
      clearPasswordResetToken();
      setComplete(true);
    } catch (error) {
      setRequestError(authErrorMessage(error, t, 'auth.resetFailed'));
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <AuthShell title={t('auth.resetMissingTitle')} description={t('auth.resetMissingDesc')}>
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>{t('auth.resetInvalidTitle')}</AlertTitle>
          <AlertDescription>{t('auth.resetInvalid')}</AlertDescription>
        </Alert>
        <Link
          className={buttonVariants({ variant: 'outline', className: 'mt-5 w-full' })}
          to="/forgot-password"
        >
          {t('auth.requestNewReset')}
        </Link>
      </AuthShell>
    );
  }

  if (complete) {
    return (
      <AuthShell title={t('auth.resetCompleteTitle')} description={t('auth.resetCompleteDesc')}>
        <Alert>
          <CircleCheck aria-hidden="true" />
          <AlertTitle>{t('auth.passwordUpdated')}</AlertTitle>
          <AlertDescription>{t('auth.sessionsRevoked')}</AlertDescription>
        </Alert>
        <Link className={buttonVariants({ className: 'mt-5 w-full' })} to="/login">
          {t('auth.signIn')}
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t('auth.resetTitle')} description={t('auth.resetDesc')}>
      <form onSubmit={handleSubmit} noValidate>
        <FieldGroup>
          {requestError && (
            <Alert variant="destructive">
              <AlertCircle aria-hidden="true" />
              <AlertTitle>{t('auth.resetFailedTitle')}</AlertTitle>
              <AlertDescription>{requestError}</AlertDescription>
            </Alert>
          )}
          <Field data-invalid={Boolean(fieldErrors.password)}>
            <FieldLabel htmlFor="new-password">{t('auth.newPassword')}</FieldLabel>
            <Input
              id="new-password"
              name="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby="new-password-description new-password-error"
              disabled={loading}
            />
            <FieldDescription id="new-password-description">{t('auth.passwordHint')}</FieldDescription>
            <FieldError id="new-password-error">{fieldErrors.password}</FieldError>
          </Field>
          <Field data-invalid={Boolean(fieldErrors.confirmation)}>
            <FieldLabel htmlFor="confirm-password">{t('auth.confirmPassword')}</FieldLabel>
            <Input
              id="confirm-password"
              name="password-confirmation"
              type="password"
              autoComplete="new-password"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              aria-invalid={Boolean(fieldErrors.confirmation)}
              aria-describedby={fieldErrors.confirmation ? 'confirm-password-error' : undefined}
              disabled={loading}
            />
            <FieldError id="confirm-password-error">{fieldErrors.confirmation}</FieldError>
          </Field>
          <Button type="submit" size="lg" className="w-full" disabled={loading}>
            {loading && <LoaderCircle data-icon="inline-start" className="animate-spin" aria-hidden="true" />}
            {loading ? t('auth.updatingPassword') : t('auth.updatePassword')}
          </Button>
        </FieldGroup>
      </form>
    </AuthShell>
  );
}
