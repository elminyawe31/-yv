"use client"

/**
 * ELMINYAWE bilingual UI system (Arabic ⇄ English).
 *
 * - `<LangProvider>` wraps the whole app (page.tsx).
 * - `useLang()` returns { lang, setLang, toggle, tr, isRTL }.
 * - `tr(ar, en)` picks the string for the active language.
 * - Engine names are ALWAYS generic: «المحرك 1 / Engine 1» —
 *   internal provider identities are never exposed to users.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"

export type Lang = "ar" | "en"

const STORAGE_KEY = "elminyawe.lang"

interface LangContextValue {
  lang: Lang
  setLang: (lang: Lang) => void
  toggle: () => void
  /** Pick the active-language string. */
  tr: (ar: string, en: string) => string
  isRTL: boolean
}

const LangContext = createContext<LangContextValue>({
  lang: "ar",
  setLang: () => {},
  toggle: () => {},
  tr: (ar) => ar,
  isRTL: true,
})

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("ar")

  /* Hydrate the saved preference (client only).
   * localStorage is an external system read once on mount — setState here is
   * the standard SSR-safe hydration pattern (server renders Arabic default). */
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time external-store hydration
      if (saved === "en" || saved === "ar") setLangState(saved)
    } catch {
      /* private mode etc. */
    }
  }, [])

  /* Keep <html> attributes in sync so direction + a11y follow the language. */
  useEffect(() => {
    const el = document.documentElement
    el.lang = lang
    el.dir = lang === "ar" ? "rtl" : "ltr"
  }, [lang])

  const setLang = useCallback((next: Lang) => {
    setLangState(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* ignore */
    }
  }, [])

  const toggle = useCallback(() => {
    setLangState((prev) => {
      const next: Lang = prev === "ar" ? "en" : "ar"
      try {
        window.localStorage.setItem(STORAGE_KEY, next)
      } catch {
        /* ignore */
      }
      return next
    })
  }, [])

  const tr = useCallback((ar: string, en: string) => (lang === "en" ? en : ar), [lang])

  const value = useMemo<LangContextValue>(
    () => ({ lang, setLang, toggle, tr, isRTL: lang === "ar" }),
    [lang, setLang, toggle, tr]
  )

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>
}

export function useLang(): LangContextValue {
  return useContext(LangContext)
}

/* ============================================================
 *  Engine display names — generic numbering only.
 *  Accepts any historic identifier (id, techLabel, DB value).
 * ============================================================ */

const ENGINE_NUMBERS: Record<string, number> = {
  // engine 1 — protection-bypass engine (cdnframe + Turnstile solver)
  marisa: 1,
  marisaenterprises: 1,
  cdnframe: 1,
  engine1: 1,
  "engine 1": 1,
  // engine 2 — fast backup API engine (ytmp3.gl)
  ytmp3gl: 2,
  "ytmp3.gl": 2,
  engine2: 2,
  "engine 2": 2,
  // historic rows only (yt-dlp was removed from the download chain;
  // it never ran on Vercel — kept so old self-hosted rows still render)
  ytdlp: 3,
  "yt-dlp": 3,
  engine3: 3,
  "engine 3": 3,
}

export function engineNumber(idOrLabel: string | undefined | null): number | null {
  if (!idOrLabel) return null
  const key = String(idOrLabel).trim().toLowerCase()
  return ENGINE_NUMBERS[key] ?? null
}

/** «المحرك 1» / «Engine 1» — falls back to the ELMINYAWE brand. */
export function engineDisplayName(idOrLabel: string | undefined | null, lang: Lang): string {
  const n = engineNumber(idOrLabel)
  if (n) return lang === "en" ? `Engine ${n}` : `المحرك ${n}`
  return "ELMINYAWE"
}

/** Storage label shown on result cards (never names the backend). */
export function storageLabel(storage: string | undefined | null, lang: Lang): string {
  if (storage === "local") return lang === "en" ? "Local storage" : "تخزين محلي"
  return lang === "en" ? "Permanent external storage" : "تخزين خارجي دائم"
}

/** Build an absolute link from the site's OWN origin — works on any domain
 *  the platform is deployed to (the owner migrates hosts frequently). */
export function absoluteLink(path: string | undefined | null): string {
  if (!path) return ""
  if (typeof window === "undefined") return path
  if (/^https?:\/\//i.test(path)) return path
  return `${window.location.origin}${path.startsWith("/") ? path : `/${path}`}`
}
