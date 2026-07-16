import { Keyboard, KeyRound, Moon, Palette, Sun } from "lucide-react";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/primitives/dialog";
import { useTranslation } from "../../i18n";
import { cn } from "../../lib/utils";
import { useSettingsStore } from "../../stores/settingsStore";
import { ApiTokensPanel } from "./ApiTokensPanel";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

type SettingsTab = "appearance" | "security";

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const { t } = useTranslation();
  const { theme, setTheme, language, setLanguage } = useSettingsStore();
  const [tab, setTab] = useState<SettingsTab>("appearance");

  const handleClose = () => {
    setTab("appearance");
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && handleClose()}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] sm:max-w-3xl"
        closeLabel={t("common.close")}
      >
        <DialogHeader>
          <DialogTitle>{t("settings.title")}</DialogTitle>
          <DialogDescription>{t("settings.description")}</DialogDescription>
        </DialogHeader>

        <div className="flex min-h-0 flex-col gap-4 sm:flex-row sm:gap-5">
          <nav
            aria-label={t("settings.sections")}
            className="grid shrink-0 grid-cols-2 content-start gap-1 border-b pb-3 sm:w-40 sm:grid-cols-1 sm:self-stretch sm:border-r sm:border-b-0 sm:pr-4 sm:pb-0"
          >
            <SettingsTabButton
              active={tab === "appearance"}
              icon={<Palette aria-hidden="true" />}
              onClick={() => setTab("appearance")}
            >
              {t("settings.appearance")}
            </SettingsTabButton>
            <SettingsTabButton
              active={tab === "security"}
              icon={<KeyRound aria-hidden="true" />}
              onClick={() => setTab("security")}
            >
              {t("settings.security")}
            </SettingsTabButton>
          </nav>

          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-1">
            {tab === "appearance" ? (
              <AppearancePanel
                theme={theme}
                language={language}
                setTheme={setTheme}
                setLanguage={setLanguage}
              />
            ) : open ? (
              <ApiTokensPanel />
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SettingsTabButton({
  active,
  icon,
  children,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-4",
        active
          ? "bg-muted font-medium text-foreground"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
      onClick={onClick}
    >
      {icon}
      <span className="truncate">{children}</span>
    </button>
  );
}

function AppearancePanel({
  theme,
  language,
  setTheme,
  setLanguage,
}: {
  theme: "day" | "night";
  language: "zh" | "en";
  setTheme: (theme: "day" | "night") => void;
  setLanguage: (language: "zh" | "en") => void;
}) {
  const { t } = useTranslation();
  return (
    <section aria-labelledby="appearance-heading" className="space-y-6">
      <div>
        <h2 id="appearance-heading" className="text-base font-medium">
          {t("settings.appearance")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("settings.appearanceDescription")}
        </p>
      </div>

      <div>
        <h3 className="mb-1 text-sm font-medium">{t("settings.theme")}</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          {t("settings.themeDescription")}
        </p>
        <div className="flex flex-wrap gap-2">
          <ChoiceButton active={theme === "day"} onClick={() => setTheme("day")}>
            <Sun aria-hidden="true" />
            {t("settings.day")}
          </ChoiceButton>
          <ChoiceButton active={theme === "night"} onClick={() => setTheme("night")}>
            <Moon aria-hidden="true" />
            {t("settings.night")}
          </ChoiceButton>
        </div>
      </div>

      <div className="h-px bg-border" />

      <div>
        <h3 className="mb-1 text-sm font-medium">{t("settings.language")}</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          {t("settings.languageDescription")}
        </p>
        <div className="flex flex-wrap gap-2">
          {(["zh", "en"] as const).map((nextLanguage) => (
            <ChoiceButton
              key={nextLanguage}
              active={language === nextLanguage}
              onClick={() => setLanguage(nextLanguage)}
            >
              {t(`settings.${nextLanguage}`)}
            </ChoiceButton>
          ))}
        </div>
      </div>

      <div className="h-px bg-border" />

      <div>
        <h3 className="mb-1 text-sm font-medium">{t("settings.shortcuts")}</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          {t("settings.shortcutsComing")}
        </p>
        <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm text-muted-foreground">
          <Keyboard className="size-4" aria-hidden="true" />
          {t("settings.shortcutsComing")}
        </div>
      </div>
    </section>
  );
}

function ChoiceButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:size-4",
        active
          ? "border-primary bg-primary/5 text-foreground"
          : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
