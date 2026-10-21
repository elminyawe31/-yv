"use client"

import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { Cpu, Zap } from "lucide-react"
import { engineDisplayName, useLang } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/* ------------------------------------------------------------------ */
/*  Live engine status strip — mirrors /api/health in the UI so users  */
/*  always see which conversion engines are alive before they start.  */
/*  Engines are shown by NUMBER ONLY («المحرك 1» / «Engine 1»).       */
/* ------------------------------------------------------------------ */

interface EngineEntry {
  id: string
  label: string
  kind: "api" | "local"
  order: number
  available: boolean
  note?: string
}

export function EngineStatus() {
  const { lang, tr } = useLang()
  const [engines, setEngines] = useState<EngineEntry[] | null>(null)

  useEffect(() => {
    let cancelled = false
    let lastFetch = 0
    /* Bandwidth-safe polling:
     *  • 90s cadence (the response is edge-cached ~30s anyway)
     *  • skipped entirely while the tab is hidden — background tabs
     *    used to keep hammering /api/health forever for nobody.
     *  • one throttled refresh when the user comes back (>30s stale). */
    const load = (force = false) => {
      if (cancelled) return
      if (typeof document !== "undefined" && document.hidden) return
      if (!force && Date.now() - lastFetch < 25_000) return
      lastFetch = Date.now()
      fetch("/api/health")
        .then((r) => r.json())
        .then((data) => {
          if (!cancelled && data.ok && Array.isArray(data.engines)) setEngines(data.engines)
        })
        .catch(() => {})
    }
    const onVisible = () => {
      if (!document.hidden && Date.now() - lastFetch > 30_000) load(true)
    }
    load(true)
    const timer = setInterval(() => load(), 90_000)
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      cancelled = true
      clearInterval(timer)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [])

  const active = engines?.filter((e) => e.available).length ?? 0
  const total = engines?.length ?? 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
      className="mb-6 flex flex-wrap items-center justify-center gap-2"
      role="status"
      aria-label={tr(
        `حالة المحركات: ${active} من ${total} نشطة`,
        `Engine status: ${active} of ${total} live`
      )}
    >
      <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold text-muted-foreground">
        <Cpu className="h-3.5 w-3.5 text-[#e9a23b]/70" />
        {tr("محركات التحويل", "Conversion engines")}
      </span>

      {!engines ? (
        // Skeleton pulse while loading
        [0, 1].map((i) => (
          <span key={i} className="skeleton-shimmer h-[30px] w-24 rounded-full" aria-hidden="true" />
        ))
      ) : (
        engines.map((engine, i) => {
          const name = engineDisplayName(engine.id, lang)
          return (
            <motion.span
              key={engine.id}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.2 + i * 0.08, duration: 0.4 }}
              title={tr(
                engine.available ? `${name} — نشط` : `${name} — غير مهيأ`,
                engine.available ? `${name} — live` : `${name} — not configured`
              )}
              className={cn(
                "group inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-[11px] font-bold transition-all duration-300",
                engine.available
                  ? "border-[#2dd4a7]/25 bg-[#2dd4a7]/[0.06] text-[#8ae6c8] hover:border-[#2dd4a7]/45 hover:bg-[#2dd4a7]/10"
                  : "border-white/8 bg-white/[0.02] text-muted-foreground/60 hover:border-white/16"
              )}
            >
              <span className="relative flex h-1.5 w-1.5 shrink-0" aria-hidden="true">
                {engine.available ? (
                  <>
                    <span className="absolute h-full w-full animate-ping rounded-full bg-[#2dd4a7] opacity-60" />
                    <span className="relative h-1.5 w-1.5 rounded-full bg-[#2dd4a7] shadow-[0_0_6px_rgba(45,212,167,0.9)]" />
                  </>
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-white/20" />
                )}
              </span>
              <Zap
                className={cn("h-3 w-3", engine.available ? "text-[#2dd4a7]/80" : "text-muted-foreground/40")}
                aria-hidden="true"
              />
              <span>{name}</span>
            </motion.span>
          )
        })
      )}

      {engines && (
        <span className="text-[10.5px] font-medium text-muted-foreground/50">
          {tr(`${active}/${total} نشط — تجاوب تلقائي عند التعطل`, `${active}/${total} live — automatic failover`)}
        </span>
      )}
    </motion.div>
  )
}
