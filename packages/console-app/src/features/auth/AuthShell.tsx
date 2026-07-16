import {
  Languages,
  Moon,
  PackageCheck,
  RadioTower,
  ScanSearch,
  ShieldCheck,
  Sun,
  Upload,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from '../../i18n';
import { useSettingsStore } from '../../stores/settingsStore';

interface AuthShellProps {
  title: string;
  description: string;
  children: ReactNode;
}

export function AuthShell({ title, description, children }: AuthShellProps) {
  const { t } = useTranslation();
  const language = useSettingsStore((state) => state.language);
  const setLanguage = useSettingsStore((state) => state.setLanguage);
  const theme = useSettingsStore((state) => state.theme);
  const setTheme = useSettingsStore((state) => state.setTheme);
  const releasePath = [
    { icon: Upload, label: t('auth.capUpload') },
    { icon: ScanSearch, label: t('auth.capInspect') },
    { icon: RadioTower, label: t('auth.capRollback') },
  ];

  return (
    <main className="auth-shell relative min-h-dvh overflow-hidden bg-muted/25">
      <div className="absolute inset-x-0 top-0 h-1 bg-primary" aria-hidden="true" />

      <header className="relative z-10 h-20 border-b bg-background/90">
        <div className="mx-auto flex h-full w-full max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
              <PackageCheck className="size-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="font-semibold tracking-tight">{t('app.name')}</p>
              <p className="truncate text-xs text-muted-foreground">{t('auth.consoleLabel')}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="inline-flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              onClick={() => setLanguage(language === 'zh' ? 'en' : 'zh')}
              aria-label={t('auth.switchLanguage')}
              title={t('auth.switchLanguage')}
            >
              <Languages className="size-4" aria-hidden="true" />
              <span>{language === 'zh' ? 'EN' : '中'}</span>
            </button>
            <button
              type="button"
              className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              onClick={() => setTheme(theme === 'day' ? 'night' : 'day')}
              aria-label={t('auth.switchTheme')}
              title={t('auth.switchTheme')}
            >
              {theme === 'day' ? (
                <Moon className="size-4" aria-hidden="true" />
              ) : (
                <Sun className="size-4" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </header>

      <div className="relative mx-auto grid w-full max-w-7xl items-center gap-12 px-4 py-10 sm:px-6 sm:py-14 lg:min-h-[calc(100dvh-5rem)] lg:grid-cols-[minmax(0,1fr)_27rem] lg:gap-20 lg:px-8 lg:py-10">
        <section
          className="order-2 max-w-2xl lg:order-1 lg:pr-8"
          aria-label={t('auth.productOverview')}
        >
          <p className="text-sm font-medium text-muted-foreground">{t('auth.productEyebrow')}</p>
          <h2 className="mt-3 max-w-2xl text-4xl leading-[1.08] font-semibold tracking-[-0.035em] text-balance sm:text-5xl">
            {t('auth.productTitle')}
          </h2>
          <p className="mt-5 max-w-xl text-base leading-7 text-muted-foreground text-pretty">
            {t('auth.productDesc')}
          </p>

          <ol className="mt-9 border-y" aria-label={t('auth.releasePath')}>
            {releasePath.map(({ icon: Icon, label }, index) => (
              <li
                key={label}
                className="flex min-h-16 items-center gap-4 border-b py-3 last:border-b-0"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-background text-foreground">
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <span className="text-sm font-medium">{label}</span>
                <span className="ml-auto font-mono text-xs text-muted-foreground" aria-hidden="true">
                  {String(index + 1).padStart(2, '0')}
                </span>
              </li>
            ))}
          </ol>

          <div className="mt-6 flex max-w-xl items-start gap-3 text-sm leading-6 text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p>{t('auth.secureSession')}</p>
          </div>
        </section>

        <section className="order-1 w-full lg:order-2" aria-labelledby="auth-title">
          <div className="rounded-xl border bg-card p-6 sm:p-8">
            <div className="mb-8 flex items-center justify-between gap-4 border-b pb-4 text-xs text-muted-foreground">
              <span>{t('auth.statusSelfHosted')}</span>
              <span className="flex items-center gap-2 font-medium text-foreground">
                <span className="size-1.5 rounded-full bg-foreground" aria-hidden="true" />
                {t('auth.statusReady')}
              </span>
            </div>
            <header>
              <h1 id="auth-title" className="text-2xl font-semibold tracking-tight text-balance">
                {title}
              </h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground text-pretty">{description}</p>
            </header>
            <div className="mt-8">{children}</div>
          </div>
        </section>
      </div>
    </main>
  );
}
