import { IconKeyboard, IconMoon, IconPalette, IconSun, IconX } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from '../../i18n';
import { useSettingsStore } from '../../stores/settingsStore';
import styles from './SettingsDialog.module.css';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const { t } = useTranslation();
  const { theme, setTheme, language, setLanguage } = useSettingsStore();
  const [tab] = useState<'appearance'>('appearance');

  if (!open) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className={styles.header}>
          <span className={styles.headerTitle}>{t('settings.title')}</span>
          <button type="button" className={styles.closeBtn} onClick={onClose}>
            <IconX size={18} />
          </button>
        </div>

        {/* Body */}
        <div className={styles.body}>
          {/* Left side menu */}
          <div className={styles.sideMenu}>
            <button type="button" className={`${styles.menuItem} ${styles.menuItemActive}`}>
              <IconPalette size={16} />
              {t('settings.appearance')}
            </button>
            <button
              type="button"
              className={styles.menuItem}
              style={{ opacity: 0.4, cursor: 'not-allowed' }}
              disabled
            >
              <IconKeyboard size={16} />
              {t('settings.shortcuts')}
            </button>
          </div>

          {/* Right content */}
          <div className={styles.content}>
            {tab === 'appearance' && (
              <>
                {/* Theme */}
                <section className={styles.section}>
                  <h2 className={styles.sectionTitle}>{t('settings.theme')}</h2>
                  <p className={styles.sectionDesc}>{t('settings.appearance')}</p>
                  <div className={styles.radioGroup}>
                    <button
                      type="button"
                      className={`${styles.radioOption}${theme === 'day' ? ` ${styles.radioActive}` : ''}`}
                      onClick={() => setTheme('day')}
                    >
                      <span className={`${styles.radioDot}${theme === 'day' ? ` ${styles.radioDotActive}` : ''}`}>
                        {theme === 'day' && <span className={styles.radioDotInner} />}
                      </span>
                      <IconSun size={18} />
                      <span className={styles.radioLabel}>{t('settings.day')}</span>
                    </button>
                    <button
                      type="button"
                      className={`${styles.radioOption}${theme === 'night' ? ` ${styles.radioActive}` : ''}`}
                      onClick={() => setTheme('night')}
                    >
                      <span className={`${styles.radioDot}${theme === 'night' ? ` ${styles.radioDotActive}` : ''}`}>
                        {theme === 'night' && <span className={styles.radioDotInner} />}
                      </span>
                      <IconMoon size={18} />
                      <span className={styles.radioLabel}>{t('settings.night')}</span>
                    </button>
                  </div>
                </section>

                {/* Language */}
                <section className={styles.section}>
                  <h2 className={styles.sectionTitle}>{t('settings.language')}</h2>
                  <p className={styles.sectionDesc}>{t('settings.language')}</p>
                  <div className={styles.radioGroup}>
                    {(['zh', 'en'] as const).map((lang) => {
                      const isActive = language === lang;
                      return (
                        <button
                          key={lang}
                          type="button"
                          className={`${styles.radioOption}${isActive ? ` ${styles.radioActive}` : ''}`}
                          onClick={() => setLanguage(lang)}
                        >
                          <span className={`${styles.radioDot}${isActive ? ` ${styles.radioDotActive}` : ''}`}>
                            {isActive && <span className={styles.radioDotInner} />}
                          </span>
                          <span className={styles.radioLabel}>{t(`settings.${lang}`)}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>

                {/* Keyboard Shortcuts */}
                <section className={styles.section}>
                  <h2 className={styles.sectionTitle}>{t('settings.shortcuts')}</h2>
                  <p className={styles.sectionDesc}>{t('settings.shortcutsComing')}</p>
                  <div className={styles.comingSoon}>
                    <IconKeyboard size={18} />
                    {t('settings.shortcutsComing')}
                  </div>
                </section>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
