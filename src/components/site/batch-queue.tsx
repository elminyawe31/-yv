"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  ListMusic, Plus, Loader2, CheckCircle2, AlertTriangle, Clock3, Play, Pause,
  Trash2, Copy, ExternalLink, RotateCcw, CircleX, Music4, Film, Link2, Sparkles,
  Scissors, ListVideo, X, Check,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { parseTimeInput, formatTime } from "@/lib/time"
import {
  runConvertStream, fetchVideoInfo, type ConvertResult,
} from "@/lib/convert-client"
import { useLang, engineDisplayName } from "@/lib/i18n"

/* ---------------- Types ---------------- */

export interface QueueItem {
  id: string
  url: string
  videoId?: string
  title?: string
  thumbnail?: string | null
  durationString?: string
  /** Video duration in seconds (needed for the trim editor). */
  duration?: number
  /** Channel name — embedded as the artist tag. */
  channel?: string
  type: "mp3" | "mp4"
  quality: string
  status: "pending" | "running" | "done" | "error"
  percent: number
  /** Raw engine id — rendered through engineDisplayName(item.engine, lang). */
  engine?: string
  error?: string
  result?: ConvertResult
  trim?: { start: number; end: number }
}

export interface QueueAddDetail {
  url: string
  videoId?: string
  title?: string
  thumbnail?: string | null
  durationString?: string
  duration?: number
  channel?: string
  type: "mp3" | "mp4"
  quality: string
  trim?: { start: number; end: number }
}

const STORAGE_KEY = "elminyawe.queue.v1"
const QUEUE_EVENT = "elminyawe:queue-add"

/** Fire-and-forget: adds an item to the batch queue from anywhere (e.g. the converter). */
export function dispatchQueueAdd(detail: QueueAddDetail) {
  window.dispatchEvent(new CustomEvent<QueueAddDetail>(QUEUE_EVENT, { detail }))
}

/** Fire-and-forget: adds many items at once (e.g. a whole playlist). */
export function dispatchQueueAddMany(details: QueueAddDetail[]) {
  for (const detail of details) {
    window.dispatchEvent(new CustomEvent<QueueAddDetail>(QUEUE_EVENT, { detail }))
  }
}

/* ---------------- Helpers ---------------- */

const YT_RE = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?[^#]*v=|shorts\/|live\/)|youtu\.be\/)[\w-]{6,}/i

function parseYouTubeUrls(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of text.split(/[\s,،\n]+/)) {
    const t = raw.trim()
    if (t && YT_RE.test(t) && !seen.has(t)) {
      seen.add(t)
      out.push(t)
    }
  }
  return out
}

function newId(): string {
  return `q${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

function loadQueue(): QueueItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const items = JSON.parse(raw) as QueueItem[]
    if (!Array.isArray(items)) return []
    // A page refresh kills in-flight streams — reset running items to pending.
    return items.map((i) => (i.status === "running" ? { ...i, status: "pending" as const, percent: 0 } : i))
  } catch {
    return []
  }
}

const QUALITY_MAP = {
  mp3: ["128K", "192K", "256K", "320K"],
  mp4: ["360", "480", "720", "1080"],
} as const

/* ---------------- Component ---------------- */

export function BatchQueue({ onItemComplete }: { onItemComplete?: () => void }) {
  const { lang, tr, isRTL } = useLang()
  const [items, setItems] = useState<QueueItem[]>([])
  const [hydrated, setHydrated] = useState(false)
  const [paused, setPaused] = useState(false)
  const [bulkText, setBulkText] = useState("")
  const [bulkType, setBulkType] = useState<"mp3" | "mp4">("mp3")
  const [bulkQuality, setBulkQuality] = useState<string>("128K")
  const [copiedAll, setCopiedAll] = useState(false)

  const abortRef = useRef<AbortController | null>(null)
  const runningRef = useRef<string | null>(null)
  const enrichedRef = useRef<Set<string>>(new Set())

  /* Hydrate from localStorage on mount — external-system sync (SSR-safe read) */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from an external store (localStorage) which is unavailable during SSR
    setItems(loadQueue())
    setHydrated(true)
  }, [])

  /* Persist on change */
  useEffect(() => {
    if (!hydrated) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
    } catch {
      /* storage full/unavailable — queue stays in memory */
    }
  }, [items, hydrated])

  /* Listen for add events from the converter / playlist flow */
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<QueueAddDetail>).detail
      if (!detail?.url) return
      setItems((prev) => {
        if (prev.some((i) => i.url === detail.url && i.type === detail.type && i.status !== "done")) return prev
        return [
          ...prev,
          {
            id: newId(),
            url: detail.url,
            videoId: detail.videoId,
            title: detail.title,
            thumbnail: detail.thumbnail,
            durationString: detail.durationString,
            duration: detail.duration,
            channel: detail.channel,
            type: detail.type,
            quality: detail.quality,
            trim: detail.trim,
            status: "pending",
            percent: 0,
          },
        ]
      })
    }
    window.addEventListener(QUEUE_EVENT, handler)
    return () => window.removeEventListener(QUEUE_EVENT, handler)
  }, [])

  const patchItem = useCallback((id: string, patch: Partial<QueueItem>) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)))
  }, [])

  /* Toast for external adds — debounced so playlist floods don't spam */
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<QueueAddDetail>).detail
      if (!detail?.url) return
      requestAnimationFrame(() => {
        document.getElementById("batch-queue")?.scrollIntoView({ behavior: "smooth", block: "nearest" })
      })
    }
    window.addEventListener(QUEUE_EVENT, handler)
    return () => window.removeEventListener(QUEUE_EVENT, handler)
  }, [])

  /* Lazy metadata enrichment — items added by raw URL get title/thumb/duration
     in the background so the list reads nicely and the trim editor has a duration. */
  useEffect(() => {
    if (!hydrated) return
    const candidate = items.find(
      (i) =>
        (i.status === "pending" || i.status === "error") &&
        !i.title &&
        !enrichedRef.current.has(i.id),
    )
    if (!candidate) return
    enrichedRef.current.add(candidate.id)
    let cancelled = false
    fetchVideoInfo(candidate.url)
      .then((info) => {
        if (cancelled) return
        patchItem(candidate.id, {
          title: info.title,
          thumbnail: info.thumbnail ?? undefined,
          durationString: info.durationString,
          duration: info.duration,
          channel: info.channel !== "—" ? info.channel : undefined,
          videoId: info.id,
        })
      })
      .catch(() => {
        /* metadata is a nicety — the conversion itself fetches what it needs */
      })
    return () => {
      cancelled = true
    }
  }, [items, hydrated, patchItem])

  /* Sequential processing loop — one item at a time (server concurrency = 1) */
  useEffect(() => {
    if (paused || !hydrated) return
    if (runningRef.current) return
    const next = items.find((i) => i.status === "pending")
    if (!next) return

    const id = next.id
    runningRef.current = id
    const controller = new AbortController()
    abortRef.current = controller
    // eslint-disable-next-line react-hooks/set-state-in-effect -- queue state machine: marks the item as running before driving the external stream
    patchItem(id, { status: "running", percent: 0, error: undefined })

    runConvertStream(
      {
        url: next.url,
        type: next.type,
        quality: next.quality,
        trim: next.trim ?? null,
        artist: next.channel,
        lang,
        signal: controller.signal,
      },
      {
        onPercent: (percent) => patchItem(id, { percent }),
        onEngine: (engine) => patchItem(id, { engine: engine || undefined }),
        onEvent: (ev) => {
          if (ev.stage === "done") patchItem(id, { percent: 100 })
          if (ev.stage === "upload" || ev.stage === "store") patchItem(id, { percent: 100 })
        },
      },
    )
      .then((result) => {
        patchItem(id, {
          status: "done",
          percent: 100,
          result,
          // Raw engine id — mapped to a localized display name at render time.
          engine: result.engine,
          title: result.title,
          thumbnail: result.thumbnail ?? next.thumbnail,
        })
        onItemComplete?.()
        toast.success(tr("اكتمل عنصر من الدفعة ✨", "Batch item complete ✨"), {
          description: `${result.title} · ${result.type.toUpperCase()} ${result.quality}`,
        })
      })
      .catch((err) => {
        if (err?.name === "AbortError") {
          patchItem(id, { status: "error", percent: 0, error: tr("أُلغي بواسطة المستخدم", "Cancelled by user") })
        } else {
          patchItem(id, {
            status: "error",
            percent: 0,
            error: String(err?.message || tr("فشل التحويل", "Conversion failed")).slice(0, 140),
          })
        }
      })
      .finally(() => {
        runningRef.current = null
        abortRef.current = null
      })
  }, [items, paused, hydrated, patchItem, onItemComplete, lang, tr])

  /* ---- Derived stats ---- */
  const counts = useMemo(() => {
    const done = items.filter((i) => i.status === "done")
    return {
      total: items.length,
      pending: items.filter((i) => i.status === "pending").length,
      running: items.filter((i) => i.status === "running").length,
      done: done.length,
      errors: items.filter((i) => i.status === "error").length,
      doneLinks: done.map((i) => i.result?.directPath).filter(Boolean) as string[],
    }
  }, [items])

  /* ---- Actions ---- */
  const addBulk = () => {
    const urls = parseYouTubeUrls(bulkText)
    if (!urls.length) {
      toast.error(tr("لم يُعثر على روابط يوتيوب صالحة", "No valid YouTube links found"), {
        description: tr("ألصق روابط مفصولة بمسافة أو سطر جديد", "Paste links separated by spaces or new lines"),
      })
      return
    }
    setItems((prev) => {
      const existing = new Set(prev.filter((i) => i.status !== "done").map((i) => i.url))
      const fresh = urls
        .filter((u) => !existing.has(u))
        .map<QueueItem>((url) => ({
          id: newId(),
          url,
          type: bulkType,
          quality: bulkQuality,
          status: "pending",
          percent: 0,
        }))
      return [...prev, ...fresh]
    })
    setBulkText("")
    toast.success(
      tr(
        `أُضيفت ${urls.length} ${urls.length === 1 ? "رابط" : "روابط"} إلى الدفعة`,
        `Added ${urls.length} link${urls.length === 1 ? "" : "s"} to the batch`
      ),
      {
        description: paused
          ? tr("القائمة متوقفة مؤقتًا — اضغط استئناف لبدء التحويل", "The queue is paused — press Resume to start converting")
          : undefined,
      }
    )
  }

  const removeItem = (id: string) => {
    if (runningRef.current === id) abortRef.current?.abort()
    setItems((prev) => prev.filter((i) => i.id !== id))
  }

  const retryItem = (id: string) => {
    setPaused(false)
    patchItem(id, { status: "pending", percent: 0, error: undefined })
  }

  const retryAllErrors = () => {
    if (!counts.errors) return
    setPaused(false)
    setItems((prev) =>
      prev.map((i) => (i.status === "error" ? { ...i, status: "pending" as const, percent: 0, error: undefined } : i)),
    )
    toast.info(tr(`إعادة محاولة ${counts.errors} عنصرًا`, `Retrying ${counts.errors} item${counts.errors === 1 ? "" : "s"}`))
  }

  const clearDone = () => setItems((prev) => prev.filter((i) => i.status !== "done"))

  const clearAll = () => {
    abortRef.current?.abort()
    setItems([])
  }

  const copyAllLinks = async () => {
    const origin = typeof window !== "undefined" ? window.location.origin : ""
    const links = counts.doneLinks.map((p) => `${origin}${p}`)
    if (!links.length) return
    try {
      await navigator.clipboard.writeText(links.join("\n"))
      setCopiedAll(true)
      toast.success(tr(`تم نسخ ${links.length} رابطًا`, `Copied ${links.length} link${links.length === 1 ? "" : "s"}`))
      setTimeout(() => setCopiedAll(false), 1600)
    } catch {
      toast.error(tr("تعذّر النسخ", "Copy failed"))
    }
  }

  const cancelRunning = () => abortRef.current?.abort()

  const hasItems = hydrated && items.length > 0
  const totalProgress = counts.total ? Math.round((counts.done / counts.total) * 100) : 0

  return (
    <section id="batch-queue" className="relative mx-auto mt-10 max-w-3xl scroll-mt-28 px-4 sm:px-6" aria-label={tr("قائمة الدفعات", "Batch queue")}>
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-40px" }}
        transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
      >
        {hasItems && (
          <div className="glass-deep gold-ring relative overflow-hidden rounded-3xl p-5 sm:p-6">
            {/* Header */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#e9a23b]/12 text-[#f0c274]">
                  <ListMusic className="h-4 w-4" />
                </span>
                <div>
                  <h2 className="font-display text-base font-bold">
                    {tr("قائمة الدفعات", "Batch queue")}
                    {paused && (
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md border border-[#2dd4a7]/30 bg-[#2dd4a7]/10 px-1.5 py-0.5 align-middle font-sans text-[10px] font-bold text-[#8ae6c8]",
                          isRTL ? "mr-2" : "ml-2"
                        )}
                      >
                        <Pause className="h-2.5 w-2.5" />
                        {tr("متوقفة مؤقتًا", "Paused")}
                      </span>
                    )}
                  </h2>
                  <p className="text-[11px] text-muted-foreground">
                    {tr(`${counts.total} عنصر`, `${counts.total} item${counts.total === 1 ? "" : "s"}`)} ·{" "}
                    {paused
                      ? tr("البدء موقوف — حرّر القصّ ثم استأنف", "Start is on hold — adjust trims, then resume")
                      : tr("تُحوَّل واحدًا تلو الآخر", "Converted one at a time")}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {counts.running > 0 ? (
                  <button
                    type="button"
                    onClick={cancelRunning}
                    className="btn-ghost inline-flex h-9 items-center gap-2 rounded-xl px-3.5 text-[12px] font-bold hover:border-[#e5484d]/35 hover:bg-[#e5484d]/10 hover:text-[#f0a8a5]"
                  >
                    <CircleX className="h-3.5 w-3.5" />
                    {tr("إلغاء الحالي", "Cancel current")}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setPaused((p) => !p)}
                    aria-pressed={paused}
                    title={
                      paused
                        ? tr("استئناف معالجة العناصر المنتظرة", "Resume processing the waiting items")
                        : tr(
                            "إيقاف البدء مؤقتًا — لإضافة عناصر وتحرير قصّها قبل التحويل",
                            "Pause starting — add items and adjust their trims before conversion"
                          )
                    }
                    className={cn(
                      "btn-ghost shine inline-flex h-9 items-center gap-2 rounded-xl px-4 text-[12px] font-bold",
                      paused && "border-[#2dd4a7]/35 bg-[#2dd4a7]/10 text-[#8ae6c8]",
                    )}
                  >
                    {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
                    {paused ? tr("استئناف", "Resume") : tr("إيقاف مؤقت", "Pause")}
                  </button>
                )}
              </div>
            </div>

            {/* Total progress */}
            <div className="mt-4 flex items-center gap-3">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/6">
                <div
                  className="progress-stripes h-full rounded-full bg-gradient-to-r from-[#b87a1e] via-[#e9a23b] to-[#ffd98e] transition-[width] duration-500"
                  style={{ width: `${totalProgress}%` }}
                />
              </div>
              <span className="font-mono text-[11px] font-bold text-[#f0c274]" dir="ltr">
                {counts.done}/{counts.total}
              </span>
            </div>

            {/* Items */}
            <div
              className={cn("queue-scroll mt-4 flex max-h-96 flex-col gap-2.5 overflow-y-auto", isRTL ? "pl-1" : "pr-1")}
              role="list"
              aria-label={tr("عناصر الدفعة", "Batch items")}
            >
              <AnimatePresence initial={false}>
                {items.map((item) => (
                  <QueueRow
                    key={item.id}
                    item={item}
                    onRemove={() => removeItem(item.id)}
                    onRetry={() => retryItem(item.id)}
                    onTrim={(trim) => patchItem(item.id, { trim })}
                  />
                ))}
              </AnimatePresence>
            </div>

            {/* Footer actions */}
            <div className="mt-4 flex flex-wrap items-center gap-1.5 border-t border-white/6 pt-4">
              {counts.errors > 0 && (
                <button
                  type="button"
                  onClick={retryAllErrors}
                  className="btn-ghost inline-flex h-9 items-center gap-2 rounded-xl px-4 text-[12px] font-bold hover:border-[#e9a23b]/35 hover:bg-[#e9a23b]/10 hover:text-[#f0c274]"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {tr("إعادة المحاولة", "Retry failed")} ({counts.errors})
                </button>
              )}
              {counts.doneLinks.length > 0 && (
                <button
                  type="button"
                  onClick={copyAllLinks}
                  className="btn-ghost shine inline-flex h-9 items-center gap-2 rounded-xl px-4 text-[12px] font-bold"
                >
                  {copiedAll ? <CheckCircle2 className="h-3.5 w-3.5 text-[#2dd4a7]" /> : <Copy className="h-3.5 w-3.5" />}
                  {tr("نسخ كل الروابط", "Copy all links")} ({counts.doneLinks.length})
                </button>
              )}
              {counts.done > 0 && (
                <button
                  type="button"
                  onClick={clearDone}
                  className="btn-ghost inline-flex h-9 items-center gap-2 rounded-xl px-4 text-[12px] font-bold"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  {tr("مسح المكتمل", "Clear completed")}
                </button>
              )}
              <button
                type="button"
                onClick={clearAll}
                className={cn(
                  "btn-ghost inline-flex h-9 items-center gap-2 rounded-xl px-4 text-[12px] font-bold hover:border-[#e5484d]/35 hover:bg-[#e5484d]/10 hover:text-[#f0a8a5]",
                  isRTL ? "mr-auto" : "ml-auto"
                )}
              >
                <Trash2 className="h-3.5 w-3.5" />
                {tr("مسح الكل", "Clear all")}
              </button>
            </div>
          </div>
        )}

        {/* Bulk add — always visible so the feature is discoverable even with an empty queue */}
        <div className={cn("glass rounded-2xl p-4", hasItems && "mt-3")}>
          <p className="mb-2.5 flex items-center gap-1.5 text-[12px] font-bold text-muted-foreground">
            {hasItems ? (
              <>
                <Plus className="h-3.5 w-3.5 text-[#e9a23b]/70" />
                {tr("أضف روابط متعددة دفعة واحدة — كل رابط في سطر", "Add multiple links at once — one link per line")}
              </>
            ) : (
              <>
                <ListVideo className="h-4 w-4 text-[#e9a23b]/70" />
                <span>
                  <span className="text-foreground/85">{tr("قائمة الدفعات", "Batch queue")}</span>
                  {" "}
                  {tr("— حوّل عدة روابط واحدًا تلو الآخر دون انتظار", "— convert multiple links one after another, no waiting")}
                </span>
              </>
            )}
          </p>
          <div className="flex flex-col gap-2.5 sm:flex-row">
            <div className="relative flex-1">
              <Link2 className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
              <input
                type="text"
                dir="ltr"
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addBulk()}
                placeholder="https://youtube.com/watch?v=... https://youtu.be/..."
                aria-label={tr("روابط يوتيوب متعددة", "Multiple YouTube links")}
                className="input-dark h-11 w-full rounded-xl py-3 pr-10 pl-3 font-mono text-[12.5px] tracking-tight placeholder:font-sans"
                spellCheck={false}
              />
            </div>
            <button
              type="button"
              onClick={addBulk}
              className="btn-gold shine inline-flex h-11 items-center justify-center gap-2 rounded-xl px-5 text-[13px] font-bold"
            >
              <Plus className="h-4 w-4" strokeWidth={2.4} />
              {tr("إضافة", "Add")}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <div className="flex overflow-hidden rounded-lg border border-white/10">
              {(["mp3", "mp4"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setBulkType(t)
                    setBulkQuality(QUALITY_MAP[t][0])
                  }}
                  aria-pressed={bulkType === t}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 px-3 text-[11.5px] font-bold transition-colors",
                    bulkType === t ? "bg-[#e9a23b]/15 text-[#f0c274]" : "text-muted-foreground hover:bg-white/5",
                  )}
                >
                  {t === "mp3" ? <Music4 className="h-3 w-3" /> : <Film className="h-3 w-3" />}
                  {t.toUpperCase()}
                </button>
              ))}
            </div>
            <div className="flex gap-1.5">
              {QUALITY_MAP[bulkType].map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => setBulkQuality(q)}
                  aria-pressed={bulkQuality === q}
                  className={cn(
                    "rounded-lg border px-2.5 py-1.5 font-mono text-[11px] font-bold transition-all",
                    bulkQuality === q
                      ? "border-[#e9a23b]/45 bg-[#e9a23b]/10 text-[#f0c274]"
                      : "border-white/8 bg-white/[0.02] text-foreground/70 hover:border-white/15",
                  )}
                >
                  {q.includes("K") ? q : q + "p"}
                </button>
              ))}
            </div>
          </div>
        </div>
      </motion.div>
    </section>
  )
}

/* ---------------- Single queue row ---------------- */

function QueueRow({
  item,
  onRemove,
  onRetry,
  onTrim,
}: {
  item: QueueItem
  onRemove: () => void
  onRetry: () => void
  onTrim: (trim: { start: number; end: number } | undefined) => void
}) {
  const { lang, tr } = useLang()
  const isDone = item.status === "done"
  const isRunning = item.status === "running"
  const isError = item.status === "error"
  const isAudio = item.type === "mp3"
  const [trimOpen, setTrimOpen] = useState(false)

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, scale: 0.96 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      role="listitem"
      className={cn(
        "glass relative flex items-center gap-3 rounded-xl p-3 transition-colors",
        isRunning && "queue-item-running",
        isDone && "border-[#2dd4a7]/20",
        isError && "border-[#e5484d]/25",
      )}
    >
      {/* Thumbnail */}
      <div className="relative h-10 w-[72px] shrink-0 overflow-hidden rounded-lg bg-white/4">
        {item.thumbnail ? (
          <img src={item.thumbnail} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground/50">
            {isAudio ? <Music4 className="h-4 w-4" /> : <Film className="h-4 w-4" />}
          </div>
        )}
        {item.thumbnail && (
          <span
            className={cn(
              "absolute bottom-1 left-1 rounded-[4px] px-1 font-mono text-[9px] font-bold text-white",
              isDone ? "bg-[#2dd4a7]/80" : "bg-black/75",
            )}
            dir="ltr"
          >
            {item.type.toUpperCase()}
          </span>
        )}
      </div>

      {/* Body */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold leading-6" title={item.title || item.url}>
          {item.title || item.url}
        </p>

        {isRunning && (
          <div className="mt-1.5 flex items-center gap-2.5">
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-white/6">
              <div
                className="progress-stripes h-full rounded-full bg-gradient-to-r from-[#b87a1e] via-[#e9a23b] to-[#ffd98e] transition-[width] duration-400"
                style={{ width: `${item.percent}%` }}
              />
            </div>
            <span className="font-mono text-[10px] font-bold text-[#f0c274]" dir="ltr">{item.percent}%</span>
          </div>
        )}

        {isDone && item.result && (
          <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="font-mono text-[#8ae6c8]" dir="ltr">{item.result.quality}</span>
            <span>·</span>
            <span className="font-mono" dir="ltr">{item.result.sizeMB}MB</span>
            {item.engine && (
              <>
                <span>·</span>
                <span className="font-mono text-[#f0c274]/80" dir={lang === "ar" ? "rtl" : "ltr"}>
                  ⚙ {engineDisplayName(item.engine, lang)}
                </span>
              </>
            )}
          </div>
        )}

        {isError && (
          <p className="mt-0.5 truncate text-[11px] text-[#f0a8a5]" title={item.error}>
            {item.error}
          </p>
        )}

        <div className="mt-1 flex items-center gap-2 text-[10.5px] text-muted-foreground">
          <span className="font-mono font-bold" dir="ltr">{item.type.toUpperCase()} · {item.quality}</span>
          {item.durationString && (
            <>
              <span>·</span>
              <span className="font-mono" dir="ltr">{item.durationString}</span>
            </>
          )}
          {item.trim && (
            <>
              <span>·</span>
              <span className="inline-flex items-center gap-1 font-mono font-bold text-[#f0c274]" dir="ltr">
                <Scissors className="h-3 w-3" />
                {formatTime(item.trim.start)}→{formatTime(item.trim.end)}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Status + actions */}
      <div className="flex shrink-0 items-center gap-1">
        {item.status === "pending" && (
          <>
            <button
              type="button"
              onClick={() => setTrimOpen((v) => !v)}
              aria-expanded={trimOpen}
              title={item.trim ? tr("تعديل قص المقطع", "Edit trim") : tr("قص مقطع محدد", "Trim a specific segment")}
              className={cn(
                "rounded-lg p-1.5 transition-colors",
                item.trim
                  ? "bg-[#e9a23b]/12 text-[#f0c274]"
                  : "text-muted-foreground/70 hover:bg-[#e9a23b]/10 hover:text-[#f0c274]",
              )}
              aria-label={tr("قص مقطع محدد", "Trim a specific segment")}
            >
              <Scissors className="h-3.5 w-3.5" />
            </button>
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Clock3 className="h-3.5 w-3.5 text-[#e9a23b]/60" />
              <span className="hidden sm:inline">{tr("انتظار", "Queued")}</span>
            </span>
          </>
        )}
        {isRunning && (
          <span className="flex items-center gap-1.5 text-[11px] font-bold text-[#f0c274]">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span className="hidden sm:inline">{tr("تحويل", "Converting")}</span>
          </span>
        )}
        {isDone && item.result && (
          <a
            href={item.result.directPath}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-ghost inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-bold"
            aria-label={tr(`فتح ${item.title || "الملف"}`, `Open ${item.title || "the file"}`)}
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{tr("فتح", "Open")}</span>
          </a>
        )}
        {isError && (
          <button
            type="button"
            onClick={onRetry}
            className="btn-ghost inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[11px] font-bold hover:border-[#e9a23b]/35 hover:bg-[#e9a23b]/10 hover:text-[#f0c274]"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{tr("إعادة", "Retry")}</span>
          </button>
        )}
        <button
          type="button"
          onClick={onRemove}
          className="rounded-lg p-1.5 text-muted-foreground/70 transition-colors hover:bg-[#e5484d]/12 hover:text-[#f0554d]"
          aria-label={tr("إزالة من الدفعة", "Remove from batch")}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Per-item trim editor */}
      <AnimatePresence initial={false}>
        {trimOpen && item.status === "pending" && (
          <TrimEditor
            key="trim"
            item={item}
            onApply={(trim) => {
              onTrim(trim)
              setTrimOpen(false)
            }}
            onCancel={() => setTrimOpen(false)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  )
}

/* ---------------- Per-item trim editor ---------------- */

function TrimEditor({
  item,
  onApply,
  onCancel,
}: {
  item: QueueItem
  onApply: (trim: { start: number; end: number } | undefined) => void
  onCancel: () => void
}) {
  const { tr, isRTL } = useLang()
  const [startRaw, setStartRaw] = useState(item.trim ? formatTime(item.trim.start) : "")
  const [endRaw, setEndRaw] = useState(item.trim ? formatTime(item.trim.end) : "")
  /* Without a known duration we prefetch metadata — start in the loading state
     so the effect below never needs a synchronous setState. */
  const [loading, setLoading] = useState(!item.duration)

  /* Need the duration for validation — fetch info once if missing */
  useEffect(() => {
    if (item.duration) return
    let cancelled = false
    fetchVideoInfo(item.url)
      .then((info) => {
        if (cancelled) return
        // Enrichment lives in the parent effect; here we only need the cap for
        // validation, which we can derive from the fetched duration.
        setEndRaw((cur) => cur || (info.duration ? formatTime(info.duration) : ""))
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [item.duration, item.url])

  const startParsed = startRaw ? parseTimeInput(startRaw) : 0
  const endParsed = endRaw ? parseTimeInput(endRaw) : null
  const duration = item.duration || 0

  const error = (() => {
    if (startRaw && startParsed === null)
      return tr("صيغة البداية غير صالحة (مثل 1:30)", "Invalid start format (e.g. 1:30)")
    if (endRaw && endParsed === null)
      return tr("صيغة النهاية غير صالحة (مثل 2:15)", "Invalid end format (e.g. 2:15)")
    if (startParsed !== null && endParsed !== null && endParsed - startParsed < 2)
      return tr("أقصر مقطع هو ثانيتان", "The shortest clip is 2 seconds")
    if (endParsed !== null && duration > 0 && endParsed > duration)
      return tr("النهاية تتجاوز مدة الفيديو", "The end is past the video duration")
    return ""
  })()

  const valid = !error && startParsed !== null && endParsed !== null && endParsed - startParsed >= 2
  const hasTrim = !!item.trim || (!!startRaw && !!endRaw)

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="absolute inset-x-0 bottom-0 top-0 z-10 overflow-hidden rounded-xl"
      dir={isRTL ? "rtl" : "ltr"}
    >
      <div className="trim-panel flex h-full flex-col justify-center gap-3 border border-[#e9a23b]/25 bg-[#0a0a0c]/97 p-4 backdrop-blur-md">
        <div className="flex items-center justify-between">
          <p className="flex items-center gap-1.5 text-[12px] font-bold text-[#f0c274]">
            <Scissors className="h-3.5 w-3.5" />
            {tr("قص مقطع من هذا العنصر", "Trim a clip from this item")}
            {loading && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          </p>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg p-1 text-muted-foreground/70 transition-colors hover:bg-white/8 hover:text-foreground"
            aria-label={tr("إغلاق", "Close")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <label className="block">
            <span className="mb-1 block text-[10.5px] font-bold text-muted-foreground">{tr("من", "From")}</span>
            <input
              type="text"
              dir="ltr"
              inputMode="numeric"
              value={startRaw}
              onChange={(e) => setStartRaw(e.target.value)}
              placeholder="0:00"
              className="input-dark h-10 w-full rounded-xl text-center font-mono text-[13px]"
              aria-label={tr("بداية المقطع", "Clip start")}
              autoFocus
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10.5px] font-bold text-muted-foreground">{tr("إلى", "To")}</span>
            <input
              type="text"
              dir="ltr"
              inputMode="numeric"
              value={endRaw}
              onChange={(e) => setEndRaw(e.target.value)}
              placeholder={duration ? formatTime(duration) : "9:59"}
              className="input-dark h-10 w-full rounded-xl text-center font-mono text-[13px]"
              aria-label={tr("نهاية المقطع", "Clip end")}
            />
          </label>
        </div>

        <div className="flex min-h-[18px] items-center justify-between text-[11px]">
          <span className={error ? "font-semibold text-[#f0a8a5]" : "text-muted-foreground/75"}>
            {error ||
              (valid
                ? tr(
                    `مدة المقطع: ${formatTime(endParsed - startParsed)}`,
                    `Clip length: ${formatTime(endParsed - startParsed)}`
                  )
                : tr("مثال: 0:30 إلى 1:15", "Example: 0:30 to 1:15"))}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!valid}
            onClick={() => {
              if (startParsed === null || endParsed === null) return
              onApply({ start: startParsed, end: endParsed })
            }}
            className="btn-gold inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-xl px-4 text-[12px] font-bold disabled:opacity-40"
          >
            <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
            {tr("تطبيق القص", "Apply trim")}
          </button>
          {hasTrim && (
            <button
              type="button"
              onClick={() => {
                onApply(undefined)
                setStartRaw("")
                setEndRaw("")
              }}
              className="btn-ghost inline-flex h-9 items-center gap-2 rounded-xl px-4 text-[12px] font-bold"
            >
              <X className="h-3.5 w-3.5" />
              {tr("إزالة القص", "Remove trim")}
            </button>
          )}
        </div>
      </div>
    </motion.div>
  )
}
