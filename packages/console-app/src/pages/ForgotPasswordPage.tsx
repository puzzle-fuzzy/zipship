import { AlertCircle, CircleCheck, LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Alert, AlertDescription, AlertTitle } from '../components/primitives/alert';
import { Button, buttonVariants } from '../components/primitives/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '../components/primitives/field';
import { Input } from '../components/primitives/input';
import { AuthShell } from '../features/auth/AuthShell';
import { authErrorMessage } from '../features/auth/authErrorMessage';
import { useTranslation } from '../i18n';
import { emailSchema } from '../lib/validation';
import { useAuthStore } from '../stores/authStore';

export function ForgotPasswordPage() {
  const { t } = useTranslation();
  const requestPasswordReset = useAuthStore((state) => state.requestPasswordReset);
  const [email, setEmail] = useState('');
  const [emailError, setEmailError] = useState('');
  const [requestError, setRequestError] = useState('');
  const [loading, setLoading] = useState(false);
  const [accepted, setAccepted] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setEmailError('');
    setRequestError('');
    const parsedEmail = emailSchema.safeParse(email);
    if (!parsedEmail.success) {
      setEmailError(t('auth.invalidEmail'));
      return;
    }

    setLoading(true);
    try {
      await requestPasswordReset(parsedEmail.data);
      setAccepted(true);
    } catch (error) {
      setRequestError(authErrorMessage(error, t, 'auth.resetRequestFailed'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title={t('auth.forgotTitle')} description={t('auth.forgotDesc')}>
      {accepted ? (
        <div className="grid gap-5">
          <Alert>
            <CircleCheck aria-hidden="true" />
            <AlertTitle>{t('auth.resetRequestAcceptedTitle')}</AlertTitle>
            <AlertDescription>{t('auth.resetRequestAcceptedDesc')}</AlertDescription>
          </Alert>
          <Link className={buttonVariants({ variant: 'outline', className: 'w-full' })} to="/login">
            {t('auth.backToSignIn')}
          </Link>
        </div>
      ) : (
        <>
          <form onSubmit={handleSubmit} noValidate>
            <FieldGroup>
              {requestError && (
                <Alert variant="destructive">
                  <AlertCircle aria-hidden="true" />
                  <AlertTitle>{t('auth.resetRequestFailedTitle')}</AlertTitle>
                  <AlertDescription>{requestError}</AlertDescription>
                </Alert>
              )}
              <Field data-invalid={Boolean(emailError)}>
                <FieldLabel htmlFor="reset-email">{t('auth.email')}</FieldLabel>
                <Input
                  id="reset-email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  aria-invalid={Boolean(emailError)}
                  aria-describedby={emailError ? 'reset-email-error' : undefined}
                  disabled={loading}
                />
                <FieldError id="reset-email-error">{emailError}</FieldError>
              </Field>
              <Button type="submit" size="lg" className="w-full" disabled={loading}>
                {loading && <LoaderCircle data-icon="inline-start" className="animate-spin" aria-hidden="true" />}
                {loading ? t('auth.sendingReset') : t('auth.sendReset')}
              </Button>
            </FieldGroup>
          </form>
          <p className="mt-5 text-center text-sm">
            <Link className="font-medium underline underline-offset-4" to="/login">
              {t('auth.backToSignIn')}
            </Link>
          </p>
        </>
      )}
    </AuthShell>
  );
}
