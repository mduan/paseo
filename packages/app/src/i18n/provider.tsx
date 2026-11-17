import * as Localization from "expo-localization";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { I18nextProvider } from "react-i18next";
import { isWeb } from "@/constants/platform";
import { useAppSettings } from "@/hooks/use-settings";
import { i18n, isI18nLocaleLoaded, loadI18nLocale } from "./i18next";
import { resolveSupportedLocale, type SupportedLocale } from "./locales";
import { ensureI18nLanguageForRender, reportI18nError } from "./sync-language";

interface I18nProviderProps {
  children: ReactNode;
}

function getSystemLocales(): string[] {
  if (isWeb && typeof navigator !== "undefined" && navigator.languages.length > 0) {
    return [...navigator.languages];
  }

  return Localization.getLocales().map((locale) => locale.languageTag);
}

// Returns false only until the first locale is applied, so children never render in English
// before the user's language. Later locale changes keep the current language until the new one loads.
function useI18nLocale(locale: SupportedLocale): boolean {
  const isLoaded = isI18nLocaleLoaded(locale);
  const [settledLocale, setSettledLocale] = useState<SupportedLocale>();
  const [hasStarted, setHasStarted] = useState(false);

  useEffect(() => {
    if (isLoaded) {
      return;
    }
    let isCurrent = true;
    void (async () => {
      try {
        await loadI18nLocale(locale);
      } catch (error) {
        reportI18nError("[i18n] Failed to load language", error);
      }
      if (isCurrent) {
        setSettledLocale(locale);
      }
    })();
    return () => {
      isCurrent = false;
    };
  }, [locale, isLoaded]);

  if (isLoaded) {
    ensureI18nLanguageForRender(locale, i18n);
  }

  const isReady = hasStarted || isLoaded || settledLocale === locale;
  if (isReady && !hasStarted) {
    setHasStarted(true);
  }
  return isReady;
}

export function I18nProvider({ children }: I18nProviderProps) {
  const { settings } = useAppSettings();
  const systemLocales = useMemo(() => getSystemLocales(), []);
  const locale = resolveSupportedLocale(settings.language, systemLocales);

  if (!useI18nLocale(locale)) {
    return null;
  }

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
