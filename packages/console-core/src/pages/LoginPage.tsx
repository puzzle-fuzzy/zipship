import { Box, Lock, Mail, Rocket, Upload, Users } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from '../i18n';
import { Button } from '@zipship/ui';
import { Input } from '@zipship/ui';

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === 'login') {
        await onLogin(email, password);
      } else {
        await onRegister(name, email, password);
      }
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    setMode(mode === 'login' ? 'register' : 'login');
  };

  return (
    <div className="flex min-h-dvh">
      {/* Left: Brand Panel */}
      <div className="hidden w-1/2 flex-col justify-center gap-6 bg-muted p-12 lg:flex">
        <div className="flex items-center gap-2">
          <Rocket className="size-7 text-foreground" />
          <span className="text-xl font-semibold">{t('app.name')}</span>
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">
          Deploy your static sites<br />with confidence
        </h1>
        <p className="text-sm text-muted-foreground max-w-sm">
          Upload, version, preview, and publish your static artifacts.
          A lightweight deployment platform for your team.
        </p>
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3 text-sm">
            <Upload className="size-4 text-muted-foreground" />
            <span>Upload and detect your build output</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Box className="size-4 text-muted-foreground" />
            <span>Content-addressed versioning</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Users className="size-4 text-muted-foreground" />
            <span>Team collaboration with role-based access</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <Rocket className="size-4 text-muted-foreground" />
            <span>One-click publish and instant rollback</span>
          </div>
        </div>
      </div>

      {/* Right: Form Panel */}
      <div className="flex w-full items-center justify-center p-8 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center lg:text-left">
            <h2 className="text-2xl font-semibold tracking-tight">
              {mode === 'login' ? t('auth.welcome') : t('auth.createAccount')}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {mode === 'login' ? t('auth.welcomeDesc') : t('auth.createAccountDesc')}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            {mode === 'register' && (
              <Input
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            )}

            <div className="relative">
              <Mail className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="pl-8"
              />
            </div>

            <div className="relative">
              <Lock className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                type="password"
                placeholder={mode === 'register' ? t('auth.passwordHint') : t('auth.password')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pl-8"
              />
            </div>

            <Button
              type="submit"
              className="w-full"
              disabled={loading || !email || !password || (mode === 'register' && !name)}
            >
              {loading
                ? 'Please wait...'
                : mode === 'login'
                  ? t('auth.signIn')
                  : t('auth.register')}
            </Button>
          </form>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            {mode === 'login' ? (
              <>
                {t('auth.noAccount')}{' '}
                <button type="button" className="text-foreground underline underline-offset-4 hover:text-primary" onClick={toggleMode}>
                  {t('auth.createOne')}
                </button>
              </>
            ) : (
              <>
                {t('auth.hasAccount')}{' '}
                <button type="button" className="text-foreground underline underline-offset-4 hover:text-primary" onClick={toggleMode}>
                  {t('auth.signInLink')}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
