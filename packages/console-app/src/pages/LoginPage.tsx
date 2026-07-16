import { LoaderCircle } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../components/primitives/button';
import { Field, FieldError, FieldGroup, FieldLabel } from '../components/primitives/field';
import { Input } from '../components/primitives/input';
import { AuthShell } from '../features/auth/AuthShell';
import { authErrorMessage } from '../features/auth/authErrorMessage';
import { useTranslation } from '../i18n';
import { toast } from '../lib/toast';
import { displayNameSchema, emailSchema, passwordSchema } from '../lib/validation';
import { useAuthStore } from '../stores/authStore';

type Mode = 'login' | 'register';
type FieldErrors = Partial<Record<'name' | 'email' | 'password', string>>;

export function LoginPage() {
  const { t } = useTranslation();
  const login = useAuthStore((state) => state.login);
  const register = useAuthStore((state) => state.register);
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    const nextErrors: FieldErrors = {};
    const parsedEmail = emailSchema.safeParse(email);
    const parsedPassword = passwordSchema.safeParse(password);
    const parsedName = mode === 'register' ? displayNameSchema.safeParse(name) : null;
    if (!parsedEmail.success) nextErrors.email = t('auth.invalidEmail');
    if (!parsedPassword.success) nextErrors.password = t('auth.passwordPolicy');
    if (parsedName && !parsedName.success) nextErrors.name = t('auth.invalidName');
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !parsedEmail.success || !parsedPassword.success) return;

    setLoading(true);
    try {
      if (mode === 'login') {
        await login(parsedEmail.data, parsedPassword.data);
      } else if (parsedName?.success) {
        await register(parsedName.data, parsedEmail.data, parsedPassword.data);
      }
    } catch (error) {
      toast.error(
        authErrorMessage(error, t, mode === 'login' ? 'auth.loginFailed' : 'auth.registrationFailed'),
      );
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setMode((current) => (current === 'login' ? 'register' : 'login'));
    setFieldErrors({});
  };

  return (
    <AuthShell
      title={mode === 'login' ? t('auth.welcome') : t('auth.createAccount')}
      description={mode === 'login' ? t('auth.welcomeDesc') : t('auth.createAccountDesc')}
    >
      <form onSubmit={handleSubmit} noValidate>
        <FieldGroup>
          {mode === 'register' && (
            <Field
              data-invalid={Boolean(fieldErrors.name)}
              className="motion-safe:[animation:auth-field-in_200ms_ease-out]"
            >
              <FieldLabel htmlFor="name">{t('auth.name')}</FieldLabel>
              <Input
                id="name"
                name="name"
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                aria-invalid={Boolean(fieldErrors.name)}
                aria-describedby={fieldErrors.name ? 'name-error' : undefined}
                disabled={loading}
                className="h-11 px-3"
              />
              <FieldError id="name-error">{fieldErrors.name}</FieldError>
            </Field>
          )}

          <Field data-invalid={Boolean(fieldErrors.email)}>
            <FieldLabel htmlFor="email">{t('auth.email')}</FieldLabel>
            <Input
              id="email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={Boolean(fieldErrors.email)}
              aria-describedby={fieldErrors.email ? 'email-error' : undefined}
              disabled={loading}
              className="h-11 px-3"
            />
            <FieldError id="email-error">{fieldErrors.email}</FieldError>
          </Field>

          <Field data-invalid={Boolean(fieldErrors.password)}>
            <div className="flex items-center justify-between gap-4">
              <FieldLabel htmlFor="password">{t('auth.password')}</FieldLabel>
              {mode === 'login' && (
                <Link className="text-sm font-medium underline underline-offset-4" to="/forgot-password">
                  {t('auth.forgotPassword')}
                </Link>
              )}
            </div>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={Boolean(fieldErrors.password)}
              aria-describedby={fieldErrors.password ? 'password-error' : undefined}
              disabled={loading}
              className="h-11 px-3"
            />
            <FieldError id="password-error">{fieldErrors.password}</FieldError>
          </Field>

          <Button type="submit" size="lg" className="h-11 w-full" disabled={loading}>
            {loading && <LoaderCircle data-icon="inline-start" className="animate-spin" aria-hidden="true" />}
            {loading
              ? mode === 'login'
                ? t('auth.signingIn')
                : t('auth.registering')
              : mode === 'login'
                ? t('auth.signIn')
                : t('auth.register')}
          </Button>
        </FieldGroup>
      </form>

      <p className="mt-7 border-t pt-5 text-center text-sm text-muted-foreground">
        {mode === 'login' ? t('auth.noAccount') : t('auth.hasAccount')}{' '}
        <button
          type="button"
          className="rounded-sm font-semibold text-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          onClick={toggleMode}
          disabled={loading}
        >
          {mode === 'login' ? t('auth.createOne') : t('auth.signInLink')}
        </button>
      </p>
    </AuthShell>
  );
}
