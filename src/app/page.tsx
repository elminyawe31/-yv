"use client"

import { useEffect, useState } from "react"
import dynamic from "next/dynamic"
import { LangProvider } from "@/lib/i18n"
import { AmbientBackground } from "@/components/site/background"
import { Navbar } from "@/components/site/navbar"
import { Hero } from "@/components/site/hero"
import { Converter, type ConvertResult } from "@/components/site/converter"
import { HowItWorks, Features, Faq } from "@/components/site/sections"
import { Footer } from "@/components/site/footer"

/* ============================================================
 *  Page-weight optimisation (2026-10)
 *  The eager bundle now ships ONLY the above-the-fold shell
 *  (background, navbar, hero, converter, footer). Everything
 *  else is split into lazy chunks that hydrate right after the
 *  first paint:
 *    • Below-fold dashboards  → ssr:false + skeleton placeholder
 *    • Marketing sections     → ssr:true (SEO HTML stays server-rendered,
 *                               the JS chunk itself loads lazily)
 *    • Hidden overlays/admin  → ssr:false (loaded only when needed)
 * ============================================================ */

const SectionSkeleton = ({ className = "" }: { className?: string }) => (
  <div
    aria-hidden="true"
    className={`mx-auto w-full max-w-6xl animate-pulse rounded-2xl bg-white/[0.02] ${className}`}
  />
)

const Result = dynamic(() => import("@/components/site/result").then((m) => m.Result), { ssr: false })

const BatchQueue = dynamic(() => import("@/components/site/batch-queue").then((m) => m.BatchQueue), {
  ssr: false,
  loading: () => <SectionSkeleton className="h-40" />,
})

const HistorySection = dynamic(() => import("@/components/site/history").then((m) => m.HistorySection), {
  ssr: false,
  loading: () => <SectionSkeleton className="h-[420px]" />,
})

const MyFiles = dynamic(() => import("@/components/site/my-files").then((m) => m.MyFiles), {
  ssr: false,
  loading: () => <SectionSkeleton className="h-[420px]" />,
})

const BackToTop = dynamic(() => import("@/components/site/back-to-top").then((m) => m.BackToTop), { ssr: false })
const ShortcutsOverlay = dynamic(
  () => import("@/components/site/shortcuts-overlay").then((m) => m.ShortcutsOverlay),
  { ssr: false }
)
const AdminPanel = dynamic(() => import("@/components/site/admin-panel").then((m) => m.AdminPanel), { ssr: false })

export default function Home() {
  const [result, setResult] = useState<ConvertResult | null>(null)
  const [historyKey, setHistoryKey] = useState(0)

  const bumpHistory = () => setHistoryKey((k) => k + 1)

  /* The hidden admin panel signals history wipes so the sections re-render. */
  useEffect(() => {
    const onCleared = () => setHistoryKey((k) => k + 1)
    window.addEventListener("elminyawe:history-cleared", onCleared)
    return () => window.removeEventListener("elminyawe:history-cleared", onCleared)
  }, [])

  return (
    <LangProvider>
      <div className="relative flex min-h-screen flex-col">
        <AmbientBackground />
        <div className="noise-overlay" aria-hidden="true" />

        <Navbar />

        <main className="flex-1">
          <Hero />

          <Converter
            onComplete={(res) => {
              setResult(res)
              bumpHistory()
            }}
            onReset={() => setResult(null)}
          />

          {result && <Result result={result} onReset={() => setResult(null)} />}

          <BatchQueue onItemComplete={bumpHistory} />

          <HistorySection refreshKey={historyKey} />

          {/* My files & storage — unlimited-storage files dashboard. Bumps on
           * every completed conversion and after any deletion (history-cleared). */}
          <MyFiles refreshKey={historyKey} />

          <div className="section-beam my-2" aria-hidden="true">
            <span className="beam-core" />
          </div>

          {/* Marketing sections stay statically imported (single shared module —
           * no chunk-splitting win) and are skipped by the browser until
           * scrolled near via content-visibility in the cv-auto wrapper. */}
          <div className="cv-auto">
            <HowItWorks />
          </div>

          <div className="section-beam my-2" aria-hidden="true">
            <span className="beam-core" />
          </div>

          <div className="cv-auto">
            <Features />
            <Faq />
          </div>
        </main>

        <Footer />
        <BackToTop />
        <ShortcutsOverlay />
        <AdminPanel />
      </div>
    </LangProvider>
  )
}
