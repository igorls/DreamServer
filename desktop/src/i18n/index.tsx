import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import en from "./locales/en.json";
import pt from "./locales/pt.json";
import es from "./locales/es.json";

// ── Types ────────────────────────────────────────────────────────

export type Locale = "en" | "pt" | "es";

type NestedRecord = { [key: string]: string | NestedRecord };

const LOCALES: Record<Locale, NestedRecord> = { en, pt, es };

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  pt: "Português",
  es: "Español",
};

// ── Helpers ──────────────────────────────────────────────────────

/** Resolve a dot-path like "splash.settingUp" from a nested object */
function resolve(obj: NestedRecord, path: string): string {
  const parts = path.split(".");
  let curr: string | NestedRecord = obj;
  for (const p of parts) {
    if (typeof curr !== "object" || curr === null) return path;
    curr = curr[p];
  }
  return typeof curr === "string" ? curr : path;
}

/** Replace {{var}} placeholders with values */
function interpolate(str: string, vars?: Record<string, string | number>): string {
  if (!vars) return str;
  return str.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    vars[key] !== undefined ? String(vars[key]) : `{{${key}}}`
  );
}

/** Detect browser language and map to supported locale */
function detectLocale(): Locale {
  const lang = navigator.language?.toLowerCase() ?? "en";
  if (lang.startsWith("pt")) return "pt";
  if (lang.startsWith("es")) return "es";
  return "en";
}

// ── Context ──────────────────────────────────────────────────────

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

// ── Provider ─────────────────────────────────────────────────────

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => {
    const stored = localStorage.getItem("dreamserver-locale") as Locale | null;
    return stored && LOCALES[stored] ? stored : detectLocale();
  });

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    localStorage.setItem("dreamserver-locale", l);
  }, []);

  const t = useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const raw = resolve(LOCALES[locale], key);
      return interpolate(raw, vars);
    },
    [locale]
  );

  // Set html lang attribute
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  return (
    <I18nContext value={{ locale, setLocale, t }}>
      {children}
    </I18nContext>
  );
}

// ── Hook ─────────────────────────────────────────────────────────

export function useTranslation() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useTranslation must be used inside I18nProvider");
  return ctx;
}
