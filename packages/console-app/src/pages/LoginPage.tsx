import { Lock, Mail, User } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { useTranslation } from '../i18n';
import { displayNameSchema, emailSchema, passwordSchema } from '../lib/validation';

type Mode = 'login' | 'register';

interface LoginPageProps {
  onLogin: (email: string, password: string) => Promise<void>;
  onRegister: (name: string, email: string, password: string) => Promise<void>;
}

export function LoginPage({ onLogin, onRegister }: LoginPageProps) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const emailResult = emailSchema.safeParse(email);
    if (!emailResult.success) {
      setError(emailResult.error.issues[0].message);
      return;
    }

    const passwordResult = passwordSchema.safeParse(password);
    if (!passwordResult.success) {
      setError(passwordResult.error.issues[0].message);
      return;
    }

    if (mode === 'register') {
      const nameResult = displayNameSchema.safeParse(name);
      if (!nameResult.success) {
        setError(nameResult.error.issues[0].message);
        return;
      }
    }

    setLoading(true);
    try {
      if (mode === 'login') {
        await onLogin(emailResult.data, passwordResult.data);
      } else {
        await onRegister(name.trim(), emailResult.data, passwordResult.data);
      }
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setMode(mode === 'login' ? 'register' : 'login');
    setError('');
  };

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <section className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">{t('app.name')}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t('auth.productDesc')}</p>
        </div>

        <div className="rounded-lg border bg-card p-6 shadow-sm">
          <div className="mb-6">
            <h2 className="text-xl font-semibold tracking-tight">
              {mode === 'login' ? t('auth.welcome') : t('auth.createAccount')}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {mode === 'login' ? t('auth.welcomeDesc') : t('auth.createAccountDesc')}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </div>
            )}

            {mode === 'register' && (
              <FieldIcon icon={User}>
                <Input
                  placeholder={t('auth.name')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="pl-9"
                />
              </FieldIcon>
            )}

            <FieldIcon icon={Mail}>
              <Input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-9"
              />
            </FieldIcon>

            <FieldIcon icon={Lock}>
              <Input
                type="password"
                placeholder={mode === 'register' ? t('auth.passwordHint') : t('auth.password')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pl-9"
              />
            </FieldIcon>

            <Button type="submit" className="w-full" disabled={loading || !email || !password || (mode === 'register' && !name)}>
              {loading
                ? mode === 'login'
                  ? t('auth.signingIn')
                  : t('auth.registering')
                : mode === 'login'
                  ? t('auth.signIn')
                  : t('auth.register')}
            </Button>
          </form>

          <div className="mt-5 text-center text-sm text-muted-foreground">
            {mode === 'login' ? (
              <>
                {t('auth.noAccount')}{' '}
                <button type="button" className="font-medium text-foreground underline underline-offset-4" onClick={toggleMode}>
                  {t('auth.createOne')}
                </button>
              </>
            ) : (
              <>
                {t('auth.hasAccount')}{' '}
                <button type="button" className="font-medium text-foreground underline underline-offset-4" onClick={toggleMode}>
                  {t('auth.signInLink')}
                </button>
              </>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function FieldIcon({ icon: Icon, children }: { icon: typeof Mail; children: React.ReactNode }) {
  return (
    <div className="relative">
      <Icon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      {children}
    </div>
  );
}
