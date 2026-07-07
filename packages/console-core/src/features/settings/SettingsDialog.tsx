import { Keyboard, Moon, Palette, Sun } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from '../../i18n';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@zipship/ui';
import { useSettingsStore } from '../../stores/settingsStore';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const { t } = useTranslation();
  const { theme, setTheme, language, setLanguage } = useSettingsStore();
  const [tab] = useState<'appearance'>('appearance');

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('settings.title')}</DialogTitle>
        </DialogHeader>

        <div className="flex gap-6">
          {/* Left: menu */}
          <div className="flex shrink-0 flex-col gap-1">
            <button
              type="button"
              className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium bg-muted text-foreground"
            >
              <Palette className="size-4" />
              {t('settings.appearance')}
            </button>
            <button
              type="button"
              className="flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-muted-foreground opacity-40 cursor-not-allowed"
              disabled
            >
              <Keyboard className="size-4" />
              {t('settings.shortcuts')}
            </button>
          </div>

          {/* Divider */}
          <div className="w-px bg-border" />

          {/* Right: content */}
          <div className="flex-1 min-w-0">
            {tab === 'appearance' && (
              <div className="flex flex-col gap-6">
                {/* Theme */}
                <div>
                  <h3 className="text-sm font-medium mb-1">{t('settings.theme')}</h3>
                  <p className="text-xs text-muted-foreground mb-3">{t('settings.appearance')}</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                        theme === 'day'
                          ? 'border-primary bg-primary/5 text-foreground'
                          : 'border-border text-muted-foreground hover:bg-muted'
                      }`}
                      onClick={() => setTheme('day')}
                    >
                      <Sun className="size-4" />
                      {t('settings.day')}
                    </button>
                    <button
                      type="button"
                      className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                        theme === 'night'
                          ? 'border-primary bg-primary/5 text-foreground'
                          : 'border-border text-muted-foreground hover:bg-muted'
                      }`}
                      onClick={() => setTheme('night')}
                    >
                      <Moon className="size-4" />
                      {t('settings.night')}
                    </button>
                  </div>
                </div>

                <div className="h-px bg-border" />

                {/* Language */}
                <div>
                  <h3 className="text-sm font-medium mb-1">{t('settings.language')}</h3>
                  <p className="text-xs text-muted-foreground mb-3">{t('settings.language')}</p>
                  <div className="flex gap-2">
                    {(['zh', 'en'] as const).map((lang) => (
                      <button
                        key={lang}
                        type="button"
                        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                          language === lang
                            ? 'border-primary bg-primary/5 text-foreground'
                            : 'border-border text-muted-foreground hover:bg-muted'
                        }`}
                        onClick={() => setLanguage(lang)}
                      >
                        {t(`settings.${lang}`)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="h-px bg-border" />

                {/* Keyboard Shortcuts */}
                <div>
                  <h3 className="text-sm font-medium mb-1">{t('settings.shortcuts')}</h3>
                  <p className="text-xs text-muted-foreground mb-3">{t('settings.shortcutsComing')}</p>
                  <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
                    <Keyboard className="size-4" />
                    {t('settings.shortcutsComing')}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
