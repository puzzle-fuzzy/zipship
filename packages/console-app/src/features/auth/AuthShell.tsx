import { CheckCircle2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card';
import { useTranslation } from '../../i18n';

interface AuthShellProps {
  title: string;
  description: string;
  children: ReactNode;
}

export function AuthShell({ title, description, children }: AuthShellProps) {
  const { t } = useTranslation();

  return (
    <main className="grid min-h-dvh bg-background lg:grid-cols-[minmax(0,1fr)_minmax(28rem,0.8fr)]">
      <section className="hidden border-r bg-muted/35 p-12 lg:flex lg:flex-col lg:justify-between" aria-label={t('auth.productOverview')}>
        <div>
          <p className="text-sm font-semibold tracking-tight">{t('app.name')}</p>
          <p className="mt-2 text-sm text-muted-foreground">{t('auth.consoleLabel')}</p>
        </div>

        <div className="max-w-xl">
          <p className="text-sm font-medium text-muted-foreground">{t('auth.productEyebrow')}</p>
          <h2 className="mt-3 max-w-lg text-4xl font-semibold tracking-tight text-balance">
            {t('auth.productTitle')}
          </h2>
          <p className="mt-4 max-w-lg text-base leading-7 text-muted-foreground">
            {t('auth.productDesc')}
          </p>
          <ul className="mt-7 grid gap-3 text-sm" role="list">
            {[t('auth.capInspect'), t('auth.capVersion'), t('auth.capRollback')].map((capability) => (
              <li key={capability} className="flex items-center gap-2">
                <CheckCircle2 aria-hidden="true" className="text-muted-foreground" />
                <span>{capability}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-muted-foreground">{t('auth.secureSession')}</p>
      </section>

      <section className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-7 lg:hidden">
            <p className="text-lg font-semibold tracking-tight">{t('app.name')}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t('auth.consoleLabel')}</p>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>
                <h1 className="text-xl">{title}</h1>
              </CardTitle>
              <CardDescription>{description}</CardDescription>
            </CardHeader>
            <CardContent>{children}</CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}
