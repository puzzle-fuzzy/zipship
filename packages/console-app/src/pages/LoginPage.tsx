import { CheckCircle2, Lock, Mail, Rocket, UploadCloud, User } from 'lucide-react';
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
    <main className="zip-stage min-h-dvh">
      <header className="relative z-10 flex h-14 items-center justify-between border-b-2 border-foreground bg-background px-5">
        <div className="zip-wordmark text-xl leading-none tracking-[-0.03em]">{t('app.name')}</div>
        <div className="hidden items-center gap-2 font-mono text-xs font-black sm:flex">
          <span>{t('auth.consoleLabel')}</span>
          <span className="size-1.5 rounded-full bg-foreground" />
          <span>{t('auth.secureSession')}</span>
        </div>
      </header>

      <section className="relative z-10 mx-auto grid min-h-[calc(100dvh-3.5rem)] max-w-6xl grid-cols-1 gap-6 px-5 py-8 lg:grid-cols-[1fr_360px]">
        <div className="relative min-h-[540px]">
          <span className="zip-edge left-[50%] top-[36%] w-[520px] -rotate-[154deg]" />
          <span className="zip-edge left-[50%] top-[36%] w-[420px] rotate-[28deg]" />
          <span className="zip-edge left-[50%] top-[36%] w-[360px] rotate-[96deg]" />

          <div className="zip-node zip-node-pink absolute left-[38%] top-[28%] w-64 p-5">
            <div className="mb-2 inline-flex rounded-full border-2 border-foreground bg-background px-2 py-0.5 text-[0.62rem] font-black uppercase">
              {mode === 'login' ? t('auth.secureSession') : t('auth.createWorkspace')}
            </div>
            <h1 className="text-3xl font-black leading-none tracking-[-0.04em]">
              {t('auth.productTitle')}
            </h1>
            <p className="mt-3 text-xs font-semibold leading-5">{t('auth.productDesc')}</p>
          </div>

          <InfoNode className="left-[5%] top-[8%]" icon={UploadCloud} title={t('auth.capUpload')} />
          <InfoNode className="left-[8%] top-[56%]" icon={CheckCircle2} title={t('auth.capInspect')} />
          <InfoNode className="left-[62%] top-[8%]" icon={Rocket} title={t('auth.capVersion')} />
          <InfoNode className="left-[58%] top-[63%]" icon={CheckCircle2} title={t('auth.capRollback')} />
        </div>

        <section className="zip-node self-center bg-background p-4">
          <div className="mb-4 rounded-md border-[3px] border-foreground bg-muted p-3">
            <h2 className="text-xl font-black tracking-[-0.02em]">
              {mode === 'login' ? t('auth.welcome') : t('auth.createAccount')}
            </h2>
            <p className="mt-1 text-sm font-semibold text-muted-foreground">
              {mode === 'login' ? t('auth.welcomeDesc') : t('auth.createAccountDesc')}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            {error && (
              <div className="rounded-md border-[3px] border-destructive bg-destructive/10 px-3 py-2 text-sm font-bold text-destructive">
                {error}
              </div>
            )}

            {mode === 'register' && (
              <FieldIcon icon={User}>
                <Input placeholder={t('auth.name')} value={name} onChange={(e) => setName(e.target.value)} className="pl-9" />
              </FieldIcon>
            )}

            <FieldIcon icon={Mail}>
              <Input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} className="pl-9" />
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

            <Button type="submit" disabled={loading || !email || !password || (mode === 'register' && !name)}>
              {loading
                ? mode === 'login'
                  ? t('auth.signingIn')
                  : t('auth.registering')
                : mode === 'login'
                  ? t('auth.signIn')
                  : t('auth.register')}
            </Button>
          </form>

          <div className="mt-4 text-center text-sm font-semibold text-muted-foreground">
            {mode === 'login' ? (
              <>
                {t('auth.noAccount')}{' '}
                <button type="button" className="font-black text-foreground underline underline-offset-4" onClick={toggleMode}>
                  {t('auth.createOne')}
                </button>
              </>
            ) : (
              <>
                {t('auth.hasAccount')}{' '}
                <button type="button" className="font-black text-foreground underline underline-offset-4" onClick={toggleMode}>
                  {t('auth.signInLink')}
                </button>
              </>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}

function InfoNode({ className, icon: Icon, title }: { className: string; icon: typeof UploadCloud; title: string }) {
  return (
    <div className={`zip-node absolute w-56 bg-background p-3 ${className}`}>
      <div className="mb-2 flex items-center gap-2">
        <span className="grid size-7 place-items-center rounded border-2 border-foreground bg-muted">
          <Icon className="size-4" />
        </span>
        <span className="text-xs font-black uppercase">{title}</span>
      </div>
      <p className="text-xs font-semibold leading-5 text-muted-foreground">
        Upload, inspect, preview, publish and roll back from one static release map.
      </p>
    </div>
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
