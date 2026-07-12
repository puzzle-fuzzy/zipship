import { ScrollText } from 'lucide-react';
import { useTranslation } from '../i18n';
import { ComingSoon } from '../components/ComingSoon';

/** Organization logs — placeholder until the logs feature is built. */
export function LogsPage() {
  const { t } = useTranslation();
  return <ComingSoon icon={ScrollText} title={t('logs.title')} description={t('logs.comingSoon')} />;
}
