import { IconBox, IconLock, IconMail, IconRocket, IconUpload, IconUsers } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from '../i18n';
import { Button } from '../shared/ui/Button';
import { Input } from '../shared/ui/Input';
import styles from './LoginPage.module.css';

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
    <div className={styles.page}>
      {/* Left: Brand Panel */}
      <div className={styles.brand}>
        <div className={styles.brandLogo}>
          <IconRocket size={28} className={styles.brandIcon} />
          <span className={styles.brandName}>{t('app.name')}</span>
        </div>
        <h1 className={styles.brandTitle}>
          Deploy your static sites<br />with confidence
        </h1>
        <p className={styles.brandDesc}>
          Upload, version, preview, and publish your static artifacts.
          A lightweight deployment platform for your team.
        </p>
        <div className={styles.brandFeatures}>
          <div className={styles.feature}>
            <IconUpload size={18} className={styles.featureIcon} />
            <span>Upload and detect your build output</span>
          </div>
          <div className={styles.feature}>
            <IconBox size={18} className={styles.featureIcon} />
            <span>Content-addressed versioning</span>
          </div>
          <div className={styles.feature}>
            <IconUsers size={18} className={styles.featureIcon} />
            <span>Team collaboration with role-based access</span>
          </div>
          <div className={styles.feature}>
            <IconRocket size={18} className={styles.featureIcon} />
            <span>One-click publish and instant rollback</span>
          </div>
        </div>
      </div>

      {/* Right: Form Panel */}
      <div className={styles.formPanel}>
        <div className={styles.formContainer}>
          <div className={styles.formHeader}>
            <h2 className={styles.formTitle}>
              {mode === 'login' ? t('auth.welcome') : t('auth.createAccount')}
            </h2>
            <p className={styles.formSubtitle}>
              {mode === 'login' ? t('auth.welcomeDesc') : t('auth.createAccountDesc')}
            </p>
          </div>

          <form className={styles.form} onSubmit={handleSubmit}>
            {mode === 'register' && (
              <Input
                label={t('auth.name')}
                type="text"
                placeholder="Your name"
                value={name}
                onChange={setName}
              />
            )}

            <Input
              label={t('auth.email')}
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={setEmail}
              icon={<IconMail size={16} />}
            />

            <Input
              label={t('auth.password')}
              type="password"
              placeholder={mode === 'register' ? t('auth.passwordHint') : t('auth.password')}
              value={password}
              onChange={setPassword}
              icon={<IconLock size={16} />}
            />

            <Button
              type="submit"
              fullWidth
              size="lg"
              disabled={loading || !email || !password || (mode === 'register' && !name)}
            >
              {loading
                ? 'Please wait...'
                : mode === 'login'
                  ? t('auth.signIn')
                  : t('auth.register')}
            </Button>
          </form>

          <div className={styles.formFooter}>
            {mode === 'login' ? (
              <>
                {t('auth.noAccount')}{' '}
                <button type="button" onClick={toggleMode}>{t('auth.createOne')}</button>
              </>
            ) : (
              <>
                {t('auth.hasAccount')}{' '}
                <button type="button" onClick={toggleMode}>{t('auth.signInLink')}</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
