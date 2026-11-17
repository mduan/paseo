import { createInstance } from "i18next";
import { initReactI18next } from "react-i18next";
import { observeI18nInit } from "./init";
import type { SupportedLocale } from "./locales";
import { en, type TranslationResources } from "./resources/en";

const NAMESPACE = "translation";

// English stays bundled as the fallback; other locales load on demand as separate chunks.
const LOCALE_LOADERS: Record<
  Exclude<SupportedLocale, "en">,
  () => Promise<TranslationResources>
> = {
  ar: () => import("./resources/ar").then((module) => module.ar),
  es: () => import("./resources/es").then((module) => module.es),
  fr: () => import("./resources/fr").then((module) => module.fr),
  ja: () => import("./resources/ja").then((module) => module.ja),
  ko: () => import("./resources/ko").then((module) => module.ko),
  "pt-BR": () => import("./resources/pt-BR").then((module) => module.ptBR),
  ru: () => import("./resources/ru").then((module) => module.ru),
  "zh-CN": () => import("./resources/zh-CN").then((module) => module.zhCN),
};

const i18n = createInstance();

observeI18nInit(
  i18n.use(initReactI18next).init({
    compatibilityJSON: "v4",
    fallbackLng: "en",
    lng: "en",
    resources: {
      en: { translation: en },
    },
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: false,
    },
  }),
);

export function isI18nLocaleLoaded(locale: SupportedLocale): boolean {
  return i18n.hasResourceBundle(locale, NAMESPACE);
}

export async function loadI18nLocale(locale: SupportedLocale): Promise<void> {
  if (locale === "en" || isI18nLocaleLoaded(locale)) {
    return;
  }
  const resources = await LOCALE_LOADERS[locale]();
  i18n.addResourceBundle(locale, NAMESPACE, resources);
}

export { i18n };
