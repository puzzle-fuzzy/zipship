import { Database } from 'lucide-react';
import { useTranslation } from '../i18n';
import { ComingSoon } from '../components/ComingSoon';

/** Storage management — placeholder until the storage feature is built. */
export function StoragePage() {
  const { t } = useTranslation();
  return (
    <ComingSoon icon={Database} title={t('storage.title')} description={t('storage.comingSoon')} />
  );
}
