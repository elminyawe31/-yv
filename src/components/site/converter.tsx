"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Link2, Search, Loader2, Music4, Film, Zap, X, ClipboardPaste,
  CheckCircle2, AlertTriangle, Youtube, Clock3, User2, CircleX, RotateCcw,
  ListPlus, Play, Scissors, ChevronDown, Timer, ListVideo, ListChecks,
} from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { useLang, engineDisplayName } from "@/lib/i18n"
import { useTilt } from "@/hooks/use-tilt"
import { parseTimeInput, formatTime, extractPlaylistId } from "@/lib/time"
import { dispatchQueueAdd, dispatchQueueAddMany } from "./batch-queue"
import { EngineStatus } from "./engine-status"
import { CornerTicks } from "./section-head"

/* ---------------- Types (shared with the batch queue) ---------------- */

import {
  type VideoInfo,
  type ConversionEvent,
  type ConvertResult,
  type PlaylistData,
  engineName,
  eventMessage,
  fetchPlaylist,
} from "@/lib/convert-client"

export type { ConvertResult }

type Phase = "idle" | "extracting" | "ready" | "converting" | "done"

interface TermLine {
  id: number
  time: string
  kind: "info" | "ok" | "warn" | "percent"
  text: string
}

/* ---------------- Constants ---------------- */

const QUALITIES = {
  mp3: [
    { value: "128K", label: "128 kbps", tag: "قياسي", tagEn: "Standard" },
    { value: "192K", label: "192 kbps", tag: "متوازن", tagEn: "Balanced" },
    { value: "256K", label: "256 kbps", tag: "عالي", tagEn: "High" },
    { value: "320K", label: "320 kbps", tag: "استوديو", tagEn: "Studio" },
  ],
  mp4: [
    { value: "360", label: "360p", tag: "خفيف", tagEn: "Light" },
    { value: "480", label: "480p", tag: "قياسي", tagEn: "Standard" },
    { value: "720", label: "720p", tag: "HD", tagEn: "HD" },
    { value: "1080", label: "1080p", tag: "Full HD", tagEn: "Full HD" },
  ],
} as const

/* Fallback stage labels as [Arabic, English] pairs — streamed events normally
 * carry their own localized message + en pair; these cover message-less ones. */
const STAGE_LABELS: Record<string, readonly [string, string]> = {
  resolve: ["تحليل مصدر الفيديو...", "Analyzing the video source..."],
  convert: ["استخراج وترميز الملف...", "Extracting and encoding the file..."],
  upload: ["الرفع إلى التخزين الخارجي...", "Uploading to external storage..."],
  verify: ["التحقق من صلاحية الرابط...", "Verifying the link..."],
  store: ["حفظ الملف على الخادم...", "Saving the file to the server..."],
  done: ["اكتمل التحويل بنجاح", "Conversion completed successfully"],
}

/* Quick-pick demo videos — lets first-time visitors try the flow in one click */
const DEMO_VIDEOS = [
  { id: "jNQXAC9IVRw", name: "أول فيديو على يوتيوب", nameEn: "The first YouTube video" },
  { id: "YE7VzlLtp-4", name: "Big Buck Bunny", nameEn: "Big Buck Bunny" },
  { id: "dQw4w9WgXcQ", name: "كلاسيكية الإنترنت", nameEn: "An internet classic" },
] as const

/* Conservative expected MB-per-minute per format/quality — used to warn the
 * user BEFORE converting when the result may hit the 80MB platform limit. */
const MB_PER_MIN: Record<"mp3" | "mp4", Record<string, number>> = {
  mp3: { "128K": 1.0, "192K": 1.5, "256K": 2.0, "320K": 2.4 },
  mp4: { "360": 4.5, "480": 7, "720": 11, "1080": 19 },
}
const MAX_MB = 80

function estimateSizeMB(durationSec: number, type: "mp3" | "mp4", quality: string): number {
  const perMin = MB_PER_MIN[type][quality] ?? 3
  return (perMin * durationSec) / 60
}

function nowTime(): string {
  return new Date().toLocaleTimeString("en-GB", { hour12: false })
}

/* ---------------- Component ---------------- */

export function Converter({ onComplete, onReset }: {
  onComplete: (result: ConvertResult) => void
  onReset: () => void
}) {
  const { lang, tr } = useLang()
  const [url, setUrl] = useState("")
  const [phase, setPhase] = useState<Phase>("idle")
  const [info, setInfo] = useState<VideoInfo | null>(null)
  const [infoError, setInfoError] = useState("")
  const [mediaType, setMediaType] = useState<"mp3" | "mp4">("mp3")
  const [quality, setQuality] = useState("128K")
  const [convertError, setConvertError] = useState("")
  const [lines, setLines] = useState<TermLine[]>([])
  const [percent, setPercent] = useState(0)
  const [result, setResult] = useState<ConvertResult | null>(null)
  /* Active engine id — always rendered through engineDisplayName so the
   * generic «المحرك N / Engine N» label follows the active UI language. */
  const [activeEngine, setActiveEngine] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [trimOpen, setTrimOpen] = useState(false)
  const [trimStartRaw, setTrimStartRaw] = useState("")
  const [trimEndRaw, setTrimEndRaw] = useState("")
  const [dragSide, setDragSide] = useState<"start" | "end" | null>(null)
  /* Playlist detected in the URL (list=…) — offers a bulk-add shortcut. */
  const [playlist, setPlaylist] = useState<PlaylistData | null>(null)
  const [playlistLoading, setPlaylistLoading] = useState(false)
  const trimTrackRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const termBodyRef = useRef<HTMLDivElement>(null)
  const lineIdRef = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const infoTilt = useTilt<HTMLDivElement>(5)
  /* Pending auto-conversion requested from the history section (re-convert). */
  const autoConvertRef = useRef<{ url: string; type?: "mp3" | "mp4"; quality?: string } | null>(null)
  const startConvertRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const auto = autoConvertRef.current
    if (auto && (auto.type ?? "mp3") === mediaType && auto.quality) {
      setQuality(auto.quality)
    } else {
      setQuality(mediaType === "mp3" ? "128K" : "720")
    }
  }, [mediaType])

  useEffect(() => {
    termBodyRef.current?.scrollTo({ top: termBodyRef.current.scrollHeight })
  }, [lines])

  // Keyboard shortcut: "/" (or Arabic keyboard "ذ") focuses the URL field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" && e.key !== "ذ") return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      e.preventDefault()
      inputRef.current?.focus()
      inputRef.current?.select()
      document.getElementById("converter")?.scrollIntoView({ behavior: "smooth", block: "start" })
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // Global paste: Ctrl+V anywhere on the page (outside inputs) fills the URL field.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return
      const text = e.clipboardData?.getData("text")?.trim() || ""
      if (!/^https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be|m\.youtube\.com)\//i.test(text)) return
      e.preventDefault()
      setUrl(text)
      setInfoError("")
      setInfo(null)
      setPhase((p) => (p === "converting" || p === "extracting" ? p : "idle"))
      toast.success(tr("تم التقاط الرابط من الحافظة", "Link captured from the clipboard"), {
        description: tr("اضغط «التعرف على الفيديو» للمتابعة", "Press “Identify the video” to continue"),
      })
      document.getElementById("converter")?.scrollIntoView({ behavior: "smooth", block: "start" })
    }
    window.addEventListener("paste", onPaste)
    return () => window.removeEventListener("paste", onPaste)
  }, [tr])

  // Re-convert requests dispatched from the history cards.
  useEffect(() => {
    const onReconvert = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { url?: string; type?: "mp3" | "mp4"; quality?: string }
      if (!detail?.url) return
      if (phase === "converting" || phase === "extracting") {
        toast.error(tr("هناك تحويل جارٍ بالفعل — انتظر اكتماله أولًا", "A conversion is already running — please wait for it to finish"))
        return
      }
      const type = detail.type === "mp4" ? "mp4" : "mp3"
      const validQualities = type === "mp4" ? ["360", "480", "720", "1080"] : ["128K", "192K", "256K", "320K"]
      const quality = detail.quality && validQualities.includes(detail.quality) ? detail.quality : undefined
      autoConvertRef.current = { url: detail.url, type, quality }
      setMediaType(type)
      setTrimOpen(false)
      setTrimStartRaw("")
      setTrimEndRaw("")
      setResult(null)
      setConvertError("")
      toast.info(tr("إعادة التحويل بنفس الإعدادات...", "Re-converting with the same settings..."), {
        description: tr("سيبدأ التحويل تلقائيًا بعد التعرّف على الفيديو", "Conversion will start automatically once the video is identified"),
      })
      document.getElementById("converter")?.scrollIntoView({ behavior: "smooth", block: "start" })
      void extractInfo(detail.url)
    }
    window.addEventListener("elminyawe:reconvert", onReconvert as EventListener)
    return () => window.removeEventListener("elminyawe:reconvert", onReconvert as EventListener)
  }, [phase, tr])

  const addLine = useCallback((kind: TermLine["kind"], text: string) => {
    setLines((prev) => [...prev.slice(-60), { id: ++lineIdRef.current, time: nowTime(), kind, text }])
  }, [])

  const updatePercentLine = useCallback((text: string) => {
    setLines((prev) => {
      const next = [...prev]
      for (let i = next.length - 1; i >= 0; i--) {
        if (next[i].kind === "percent") {
          next[i] = { ...next[i], time: nowTime(), text }
          return next
        }
      }
      return [...next, { id: ++lineIdRef.current, time: nowTime(), kind: "percent", text }]
    })
  }, [])

  /* ---- Step 1: extract info (optionally with a direct URL — demo chips) ---- */
  const extractInfo = async (directUrl?: string) => {
    const trimmed = (directUrl ?? url).trim()
    if (!trimmed) {
      setInfoError(tr("ألصق رابط يوتيوب أولًا.", "Paste a YouTube link first."))
      return
    }
    if (directUrl) setUrl(directUrl)
    setInfoError("")
    setInfo(null)
    setResult(null)
    setPreviewing(false)
    setPhase("extracting")
    try {
      const res = await fetch("/api/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: trimmed }),
      })
      const data = await res.json()
      if (!data.ok)
        throw new Error(
          (lang === "en" && data.errorEn) ||
            data.error ||
            tr("تعذّر التعرف على الفيديو.", "Couldn't identify the video.")
        )
      if (trimmed !== (directUrl ?? url).trim()) return
      setInfo(data.info)
      setPhase("ready")
      toast.success(tr("تم التعرف على الفيديو", "Video identified"), { description: data.info.title })
      requestAnimationFrame(() => {
        document.getElementById("format-step")?.scrollIntoView({ behavior: "smooth", block: "nearest" })
      })
      /* Auto-convert when this extraction was triggered by a re-convert request. */
      const auto = autoConvertRef.current
      if (auto && auto.url === trimmed) {
        autoConvertRef.current = null
        setTimeout(() => startConvertRef.current?.(), 80)
      }
    } catch (err) {
      setPhase("idle")
      setInfoError(
        `${(err as Error).message} ${tr("يمكنك تجربة التحويل مباشرةً إن كان الرابط صحيحًا.", "You can still try converting directly if the link is valid.")}`
      )
    }
  }

  /* ---- Step 3: convert (streaming) ---- */
  const startConvert = async () => {
    if (!url.trim()) return
    setConvertError("")
    setResult(null)
    setLines([])
    setPercent(0)
    setPhase("converting")
    const controller = new AbortController()
    abortRef.current = controller

    addLine("info", tr("محرك تحويل ELMINYAWE v3.1 — تعدد المحركات", "ELMINYAWE convert-engine v3.1 — multi-provider"))
    setActiveEngine(null)

    try {
      const res = await fetch("/api/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          type: mediaType,
          quality,
          lang,
          ...(trim ? { trim: { start: trim.start, end: trim.end } } : {}),
          ...(info?.channel && info.channel !== "—" ? { artist: info.channel } : {}),
        }),
        signal: controller.signal,
      })
      const contentType = res.headers.get("content-type") || ""
      if (!contentType.includes("ndjson")) {
        const data = await res.json().catch(() => null)
        throw new Error(
          (lang === "en" && data?.errorEn) || data?.error ||
            tr(`استجابة غير متوقعة من الخادم (HTTP ${res.status}).`, `Unexpected server response (HTTP ${res.status}).`)
        )
      }

      const reader = res.body!.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let finished = false

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split("\n")
        buffer = parts.pop() || ""
        for (const part of parts) {
          if (!part.trim() || finished) continue
          const event: ConversionEvent & ConvertResult & { ok?: boolean; error?: string; errorEn?: string } = JSON.parse(part)
          if (event.stage) {
            if (event.stage === "engine" || event.stage === "engine-skip") {
              const name = engineName(event.engine, lang)
              if (event.stage === "engine-skip") {
                addLine("warn", `${tr("تخطي", "Skipping")} ${name} — ${event.reason || tr("غير متاح", "unavailable")}`)
              } else if (event.status === "start") {
                setActiveEngine(event.engine || null)
                addLine("info", `${tr("تشغيل المحرك:", "Starting engine:")} ${name}`)
              } else if (event.status === "ok") {
                addLine("ok", `${tr("نجح المحرك:", "Engine succeeded:")} ${name}`)
                setActiveEngine(event.engine || null)
              } else if (event.status === "fail") {
                addLine("warn", `${tr("فشل المحرك:", "Engine failed:")} ${name}${event.reason ? " — " + event.reason.slice(0, 90) : ""}`)
                setActiveEngine(null)
              }
            } else if (event.stage === "download" && typeof event.percent === "number") {
              setPercent(event.percent)
              const dlMsg = eventMessage(event, lang) || tr("تنزيل المصدر", "Downloading the source")
              updatePercentLine(`${dlMsg} — ${event.percent}%`)
            } else if (event.stage === "done") {
              addLine("ok", tr("اكتمل التحويل — الرابط جاهز", "Conversion complete — the link is ready"))
              setPercent(100)
            } else {
              const fallback = STAGE_LABELS[event.stage]
              const label = eventMessage(event, lang) || (fallback ? tr(fallback[0], fallback[1]) : "")
              if (label) addLine("info", label)
              if (typeof event.percent === "number") {
                setPercent(event.percent)
                updatePercentLine(`${label} — ${event.percent}%`)
              }
              if (event.stage === "upload" || event.stage === "store") setPercent(100)
            }
          }
          if (event.ok === true && event.directUrl) {
            finished = true
            setResult(event)
            setPhase("done")
            setActiveEngine(event.engine || null)
            onComplete(event)
            toast.success(tr("الرابط جاهز ✨", "Your link is ready ✨"), {
              description: `${event.title}${event.engine ? ` · ${tr("عبر", "via")} ${engineName(event.engine, lang)}` : ""}`,
            })
          }
          if (event.ok === false) {
            finished = true
            const message = (lang === "en" && event.errorEn) || event.error
            addLine("warn", message || tr("فشل التحويل", "Conversion failed"))
            throw new Error(message || tr("تعذّر التحويل.", "Conversion failed."))
          }
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        addLine("warn", tr("أُلغيَ التحويل بواسطة المستخدم", "Conversion cancelled by the user"))
        setPhase(info ? "ready" : "idle")
        toast.info(tr("تم إلغاء التحويل", "Conversion cancelled"))
        return
      }
      setConvertError((err as Error).message)
      addLine("warn", (err as Error).message)
      setPhase(info ? "ready" : "idle")
    } finally {
      abortRef.current = null
    }
  }

  const cancelConvert = () => abortRef.current?.abort()

  /* Keep the latest startConvert closure available for deferred auto-conversion. */
  useEffect(() => {
    startConvertRef.current = startConvert
  })

  const resetAll = () => {
    setUrl("")
    setInfo(null)
    setResult(null)
    setLines([])
    setPercent(0)
    setConvertError("")
    setInfoError("")
    setPreviewing(false)
    setPlaylist(null)
    setPhase("idle")
    onReset()
  }

  /* Add current video+format to the batch queue instead of converting now */
  const addToBatch = () => {
    if (!url.trim()) return
    dispatchQueueAdd({
      url: url.trim(),
      videoId: info?.id,
      title: info?.title,
      thumbnail: info?.thumbnail,
      durationString: info?.durationString,
      duration: info?.duration || undefined,
      channel: info && info.channel !== "—" ? info.channel : undefined,
      type: mediaType,
      quality,
      trim: trim ?? undefined,
    })
    toast.success(tr("أُضيف إلى قائمة الدفعات", "Added to the batch queue"), {
      description: (info?.title || url.trim()) + (trim ? ` · ${tr("مقطع", "clip")} ${formatTime(trim.start)}→${formatTime(trim.end)}` : ""),
    })
    requestAnimationFrame(() => {
      document.getElementById("batch-queue")?.scrollIntoView({ behavior: "smooth", block: "nearest" })
    })
  }

  /* Fetch the playlist behind the detected list= param and queue every entry. */
  const addPlaylistToBatch = async () => {
    if (!url.trim() || playlistLoading) return
    setPlaylistLoading(true)
    try {
      const data = await fetchPlaylist(url.trim())
      setPlaylist(data)
      const entries = data.items.map((entry) => ({
        url: `https://www.youtube.com/watch?v=${entry.id}`,
        videoId: entry.id,
        title: entry.title,
        thumbnail: entry.thumbnail,
        durationString: entry.durationString || undefined,
        type: mediaType,
        quality,
      }))
      dispatchQueueAddMany(entries)
      toast.success(tr("أُضيفت قائمة التشغيل إلى الدفعة", "Playlist added to the batch queue"), {
        description: `${data.title} · ${tr(`${data.returned} مقطعًا`, `${data.returned} clips`)} · ${mediaType.toUpperCase()} ${quality}`,
      })
      requestAnimationFrame(() => {
        document.getElementById("batch-queue")?.scrollIntoView({ behavior: "smooth", block: "nearest" })
      })
    } catch (err) {
      toast.error(tr("تعذّر جلب قائمة التشغيل", "Couldn't fetch the playlist"), {
        description: String((err as Error).message || tr("حاول مرة أخرى أو أضف المقاطع يدويًا.", "Try again or add the clips manually.")),
      })
    } finally {
      setPlaylistLoading(false)
    }
  }

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText()
      if (text) {
        setUrl(text.trim())
        setInfoError("")
        toast.success(tr("تم لصق الرابط من الحافظة", "Link pasted from the clipboard"))
      }
    } catch {
      toast.error(tr("تعذّر الوصول إلى الحافظة — الصق الرابط يدويًا", "Couldn't access the clipboard — paste the link manually"))
    }
  }

  const busy = phase === "extracting" || phase === "converting"
  const showFormatStep = info && (phase === "ready" || phase === "converting" || phase === "done")

  /* ---- Derived trim state (validated) ---- */
  const videoDuration = info?.duration || 0
  /* Playlist id present in the current URL (list=…) — drives the bulk-add banner. */
  const detectedPlaylistId = url.trim() ? extractPlaylistId(url.trim()) : null
  const startParsed = trimStartRaw ? parseTimeInput(trimStartRaw) : 0
  const endParsed = trimEndRaw ? parseTimeInput(trimEndRaw) : null
  const trimActive = trimOpen && startParsed !== null && endParsed !== null && endParsed - startParsed >= 2
  const trimError = (() => {
    if (!trimOpen) return ""
    if (trimStartRaw && startParsed === null) return tr("صيغة البداية غير صالحة (مثال: 1:30)", "Invalid start format (e.g. 1:30)")
    if (trimEndRaw && endParsed === null) return tr("صيغة النهاية غير صالحة (مثال: 2:15)", "Invalid end format (e.g. 2:15)")
    if (trimActive && videoDuration > 0 && endParsed > videoDuration) return tr("النهاية تتجاوز مدة الفيديو", "The end exceeds the video duration")
    if (startParsed !== null && endParsed !== null && endParsed - startParsed < 2) return tr("أقصر مقطع هو ثانيتان", "The shortest clip is two seconds")
    return ""
  })()
  const trim: { start: number; end: number } | null = trimActive ? { start: startParsed, end: endParsed } : null
  const clipDuration = trim ? trim.end - trim.start : videoDuration

  /* ---- Interactive trim track: pointer → time (RTL: t=0 at the right edge) ---- */
  const posToTime = useCallback((clientX: number): number => {
    const el = trimTrackRef.current
    if (!el || !videoDuration) return 0
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0) return 0
    const t = ((rect.right - clientX) / rect.width) * videoDuration
    return Math.min(videoDuration, Math.max(0, t))
  }, [videoDuration])

  const commitDrag = useCallback((side: "start" | "end", rawTime: number) => {
    if (!videoDuration) return
    const end = endParsed ?? videoDuration
    const start = startParsed ?? 0
    const t = Math.round(rawTime)
    if (side === "start") {
      const clamped = Math.min(Math.max(0, t), Math.max(0, Math.round(end) - 2))
      setTrimStartRaw(formatTime(clamped))
      if (!trimEndRaw) setTrimEndRaw(formatTime(Math.round(videoDuration)))
    } else {
      const clamped = Math.max(Math.min(Math.round(videoDuration), t), Math.round(start) + 2)
      setTrimEndRaw(formatTime(clamped))
      if (!trimStartRaw) setTrimStartRaw("0:00")
    }
  }, [videoDuration, startParsed, endParsed, trimStartRaw, trimEndRaw])

  const handleKeyDownTrim = useCallback((side: "start" | "end", e: React.KeyboardEvent) => {
    const value = side === "start" ? (trim?.start ?? 0) : (trim?.end ?? videoDuration)
    const step = e.shiftKey ? 10 : 1
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault()
      commitDrag(side, value + step)
    } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault()
      commitDrag(side, value - step)
    } else if (e.key === "Home") {
      e.preventDefault()
      commitDrag(side, side === "start" ? 0 : (trim?.start ?? 0) + 2)
    } else if (e.key === "End") {
      e.preventDefault()
      commitDrag(side, side === "end" ? videoDuration : (trim?.end ?? videoDuration) - 2)
    }
  }, [commitDrag, trim, videoDuration])

  return (
    <section id="converter" className="relative scroll-mt-28 pb-8">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 32 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* Section heading */}
          <div className="mb-6 text-center">
            <h2 className="font-display text-2xl font-bold sm:text-3xl">
              {tr("استوديو ", "The ")}<span className="text-gold-gradient">{tr("التحويل", "Conversion Studio")}</span>
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              {tr("ثلاث خطوات بسيطة تفصلك عن رابطك المباشر", "Three simple steps stand between you and your direct link")}
            </p>
          </div>

          {/* Live engine health strip */}
          <EngineStatus />

          {/* ===== Main glass panel ===== */}
          <div className="glass-deep gold-ring relative overflow-hidden rounded-3xl p-5 sm:p-8">
            {/* Top accent line */}
            <div
              className="absolute inset-x-0 top-0 h-px"
              style={{ background: "linear-gradient(90deg, transparent 5%, rgba(233,162,59,0.5), transparent 95%)" }}
            />

            {/* Step indicator */}
            <div className="mb-6 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#e9a23b]/12 text-xs font-bold text-[#f0c274]">
                  {tr("١", "1")}
                </span>
                <span className="text-sm font-bold">{tr("الرابط", "Link")}</span>
              </div>
              <div className="flex items-center gap-1.5">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className={cn(
                      "h-1.5 rounded-full transition-all duration-700",
                      phase === "idle" || phase === "extracting"
                        ? i === 0 ? "w-8 bg-[#e9a23b]" : "w-4 bg-white/10"
                        : phase === "ready" || phase === "converting"
                          ? i === 1 ? "w-8 bg-[#e9a23b]" : i === 0 ? "w-8 bg-[#e9a23b]/50" : "w-4 bg-white/10"
                          : "w-8 bg-[#e9a23b]"
                    )}
                  />
                ))}
              </div>
            </div>

            {/* URL input */}
            <div className="group relative">
              <div className="pointer-events-none absolute -inset-1 rounded-2xl bg-[#e9a23b]/10 opacity-0 blur-md transition-opacity duration-500 group-focus-within:opacity-100" />
              <div className="relative flex flex-col gap-3 sm:flex-row">
                <div className="relative flex-1">
                  <Link2 className="pointer-events-none absolute right-4 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-muted-foreground/70" />
                  <input
                    ref={inputRef}
                    type="url"
                    dir="ltr"
                    value={url}
                    onChange={(e) => {
                      setUrl(e.target.value)
                      setInfoError("")
                      setPlaylist(null)
                      if (info) {
                        setInfo(null)
                        setPhase("idle")
                      }
                    }}
                    onKeyDown={(e) => e.key === "Enter" && !busy && extractInfo()}
                    onPaste={(e) => {
                      const text = e.clipboardData.getData("text").trim()
                      if (/^https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be|m\.youtube\.com)\//i.test(text)) {
                        setInfo(null)
                        setPhase("idle")
                        setInfoError("")
                        setPlaylist(null)
                      }
                    }}
                    placeholder="https://youtube.com/watch?v=..."
                    aria-label={tr("رابط فيديو يوتيوب", "YouTube video link")}
                    className="input-dark h-13 w-full rounded-2xl py-4 pr-12 pl-24 font-mono text-sm tracking-tight placeholder:font-sans"
                    disabled={busy && phase === "converting"}
                    spellCheck={false}
                  />
                  <div className="absolute left-2.5 top-1/2 flex -translate-y-1/2 items-center gap-1">
                    {url ? (
                      <button
                        type="button"
                        onClick={() => { setUrl(""); setInfo(null); setPhase("idle"); setInfoError(""); setPlaylist(null) }}
                        className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-white/8 hover:text-foreground"
                        aria-label={tr("مسح الرابط", "Clear the link")}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={pasteFromClipboard}
                        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-white/8 hover:text-[#f0c274]"
                        aria-label={tr("لصق من الحافظة", "Paste from clipboard")}
                      >
                        <ClipboardPaste className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">{tr("لصق", "Paste")}</span>
                      </button>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => extractInfo()}
                  disabled={busy}
                  className="btn-ghost shine inline-flex h-13 items-center justify-center gap-2 rounded-2xl px-6 text-sm font-bold"
                >
                  {phase === "extracting" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {tr("جاري التعرف...", "Identifying...")}
                    </>
                  ) : (
                    <>
                      <Search className="h-4 w-4" strokeWidth={2.4} />
                      {tr("التعرف على الفيديو", "Identify the video")}
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Paste hint */}
            {!url && !busy && (
              <p className="mt-3 flex flex-wrap items-center justify-center gap-1.5 text-center text-[11px] text-muted-foreground/60">
                <ClipboardPaste className="h-3 w-3" />
                {tr("تلميح: اضغط", "Tip: press ")}
                <kbd className="rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] font-bold text-muted-foreground">Ctrl</kbd>
                +
                <kbd className="rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] font-bold text-muted-foreground">V</kbd>
                {tr("في أي مكان لالتقاط الرابط ·", " anywhere to capture the link ·")}
                <kbd className="rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] font-bold text-muted-foreground">/</kbd>
                {tr("للانتقال السريع للحقل ·", " to jump straight to the field ·")}
                <kbd className="rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 font-mono text-[10px] font-bold text-muted-foreground">?</kbd>
                {tr("لعرض الاختصارات", " to view all shortcuts")}
              </p>
            )}

            {/* Quick-pick demo videos — one-click trial for first-time visitors */}
            {!url && !busy && !info && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.35, duration: 0.5 }}
                className="mt-4 flex flex-wrap items-center justify-center gap-2"
              >
                <span className="text-[11px] font-semibold text-muted-foreground/70">
                  {tr("جرّب فورًا بفيديو جاهز:", "Try instantly with a ready-made video:")}
                </span>
                {DEMO_VIDEOS.map((demo, i) => (
                  <motion.button
                    key={demo.id}
                    type="button"
                    initial={{ opacity: 0, scale: 0.92 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.45 + i * 0.09, duration: 0.35 }}
                    onClick={() => extractInfo(`https://www.youtube.com/watch?v=${demo.id}`)}
                    className="demo-chip group"
                    aria-label={tr(`تجربة سريعة: ${demo.name}`, `Quick try: ${demo.nameEn}`)}
                  >
                    <img
                      src={`https://i.ytimg.com/vi/${demo.id}/default.jpg`}
                      alt=""
                      width={28}
                      height={20}
                      loading="lazy"
                      className="h-5 w-7 rounded-[4px] object-cover ring-1 ring-white/15 transition-transform duration-300 group-hover:scale-110"
                    />
                    <span className="text-[11.5px]">{tr(demo.name, demo.nameEn)}</span>
                  </motion.button>
                ))}
              </motion.div>
            )}

            {/* Playlist detected — offer to queue the whole list */}
            <AnimatePresence>
              {detectedPlaylistId && phase !== "converting" && (
                <motion.div
                  key="playlist-banner"
                  initial={{ opacity: 0, y: 10, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.98 }}
                  transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                  role="status"
                  className="playlist-banner mt-4"
                >
                  <span className="playlist-banner-icon">
                    <ListVideo className="h-4.5 w-4.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-bold text-[#f0c274]">
                      {tr("رابطك يحمل قائمة تشغيل", "Your link carries a playlist")}
                      {playlist && (
                        <span className="mr-1.5 font-semibold text-foreground/80">
                          {tr(`— «${playlist.title}»`, `— “${playlist.title}”`)}
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground/95">
                      {playlist
                        ? tr(
                            `${playlist.returned} مقطعًا متاحًا — أضفها كلها لقائمة الدفعات وحوّلها واحدة تلو الأخرى.`,
                            `${playlist.returned} clips available — add them all to the batch queue and convert them one by one.`,
                          )
                        : tr(
                            "يمكنك تحويل الفيديو الحالي فقط، أو إضافة كل مقاطع القائمة إلى الدفعة دفعة واحدة.",
                            "Convert only the current video, or add every entry in the playlist to the batch queue at once.",
                          )}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={addPlaylistToBatch}
                    disabled={playlistLoading}
                    className="btn-gold shine inline-flex h-11 shrink-0 items-center gap-2 rounded-xl px-4 text-[12px] font-bold"
                  >
                    {playlistLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ListChecks className="h-3.5 w-3.5" strokeWidth={2.4} />
                    )}
                    {playlistLoading ? tr("جارٍ الجلب...", "Fetching...") : tr("أضف القائمة للدفعة", "Add playlist to batch")}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Info error */}
            <AnimatePresence>
              {infoError && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="mt-4 flex items-start gap-3 rounded-xl border border-[#e5484d]/25 bg-[#e5484d]/8 p-4" role="alert">
                    <AlertTriangle className="mt-0.5 h-4.5 w-4.5 shrink-0 text-[#f0554d]" />
                    <p className="text-sm leading-6 text-[#f0a8a5]">{infoError}</p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ===== Video info card ===== */}
            <AnimatePresence>
              {info && phase !== "idle" && !result && (
                <motion.div
                  key="info-card"
                  initial={{ opacity: 0, y: 20, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -12, scale: 0.98 }}
                  transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                  className="mt-6"
                >
                  <div className="glass tilt-scene relative overflow-hidden rounded-2xl">
                    <div
                      className="tilt-card relative"
                      data-tilting="false"
                      ref={infoTilt.ref}
                      onPointerMove={infoTilt.onPointerMove}
                      onPointerLeave={infoTilt.onPointerLeave}
                    >
                      <span className="tilt-glow" aria-hidden="true" />
                      <CornerTicks />
                      <div className="flex flex-col gap-5 p-5 sm:flex-row">
                        {/* Thumbnail → inline preview player */}
                        <div className="relative mx-auto w-full max-w-[260px] shrink-0 overflow-hidden rounded-xl sm:mx-0">
                          {previewing && info ? (
                            <div className="aspect-video w-full bg-black" dir="ltr">
                              <iframe
                                src={`https://www.youtube-nocookie.com/embed/${info.id}?autoplay=1&rel=0&modestbranding=1`}
                                title={tr(`معاينة — ${info.title}`, `Preview — ${info.title}`)}
                                className="h-full w-full"
                                allow="autoplay; encrypted-media; picture-in-picture"
                                allowFullScreen
                              />
                            </div>
                          ) : info.thumbnail ? (
                            <button
                              type="button"
                              onClick={() => setPreviewing(true)}
                              className="group block w-full"
                              aria-label={tr("معاينة الفيديو قبل التحويل", "Preview the video before converting")}
                            >
                              <img
                                src={info.thumbnail}
                                alt={info.title}
                                className="aspect-video w-full object-cover transition-transform duration-700 group-hover:scale-105"
                                loading="lazy"
                              />
                              <span className="play-overlay absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-300 group-hover:opacity-100" aria-hidden="true">
                                <span className="flex h-12 w-12 items-center justify-center rounded-full border border-[#ffd98e]/50 bg-[#e9a23b]/25 backdrop-blur-sm shadow-[0_0_24px_rgba(233,162,59,0.45)] transition-transform duration-300 group-hover:scale-110">
                                  <Play className="h-5 w-5 fill-[#ffd98e] text-[#ffd98e]" style={{ transform: "scaleX(-1)" }} />
                                </span>
                              </span>
                            </button>
                          ) : (
                            <div className="skeleton-shimmer aspect-video w-full" />
                          )}
                          {!previewing && (
                            <>
                              <div className="absolute bottom-2 left-2 rounded-md bg-black/80 px-2 py-0.5 font-mono text-[11px] font-medium text-white backdrop-blur-sm">
                                {info.durationString}
                              </div>
                              <div className="absolute inset-0 rounded-xl ring-1 ring-inset ring-white/10" />
                            </>
                          )}
                        </div>
                        {/* Meta */}
                        <div className="flex min-w-0 flex-1 flex-col justify-center">
                          <h3 className="line-clamp-2 font-display text-base font-bold leading-7 sm:text-lg sm:leading-8">
                            {info.title}
                          </h3>
                          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-foreground/75">
                            <span className="inline-flex items-center gap-1.5">
                              <User2 className="h-3.5 w-3.5 text-[#e5484d]" />
                              {info.channel}
                            </span>
                            <span className="inline-flex items-center gap-1.5 font-medium">
                              <Clock3 className="h-3.5 w-3.5 text-[#f0c274]/80" />
                              <span className="font-mono">{info.durationString}</span>
                            </span>
                            <span className="inline-flex items-center gap-1.5">
                              <Youtube className="h-3.5 w-3.5 text-[#f0554d]" />
                              {tr("يوتيوب", "YouTube")}
                            </span>
                          </div>
                          {info.tooLong && (
                            <div className="mt-4 flex items-center gap-2.5 rounded-lg border border-[#e9a23b]/25 bg-[#e9a23b]/8 px-3.5 py-2.5 text-[12px] leading-5 text-[#f0c274]">
                              <AlertTriangle className="h-4 w-4 shrink-0" />
                              {tr("الفيديو طويل نسبيًا؛ قد يتجاوز حد الحجم — اختر MP3 بجودة 128K للأمان.", "This video is quite long; it may exceed the size limit — choose MP3 at 128K to be safe.")}
                            </div>
                          )}
                          {previewing && (
                            <button
                              type="button"
                              onClick={() => setPreviewing(false)}
                              className="btn-ghost mt-4 inline-flex h-9 w-fit items-center gap-2 rounded-xl px-4 text-[12px] font-bold"
                            >
                              <X className="h-3.5 w-3.5" />
                              {tr("إغلاق المعاينة", "Close preview")}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ===== Format + quality step ===== */}
            <AnimatePresence>
              {showFormatStep && !result && (
                <motion.div
                  key="format-step"
                  id="format-step"
                  initial={{ opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                  className="mt-6 scroll-mt-32"
                >
                  <div className="mb-4 flex items-center gap-2">
                    <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#e9a23b]/12 text-xs font-bold text-[#f0c274]">
                      {tr("٢", "2")}
                    </span>
                    <span className="text-sm font-bold">{tr("الصيغة والجودة", "Format & quality")}</span>
                  </div>

                  {/* Format segmented control */}
                  <div className="grid grid-cols-2 gap-3">
                    {([
                      { type: "mp3" as const, icon: Music4, title: tr("MP3 صوت", "MP3 audio"), desc: tr("مثالي للمشغّلات والاستماع", "Perfect for players and listening") },
                      { type: "mp4" as const, icon: Film, title: tr("MP4 فيديو", "MP4 video"), desc: tr("صوت وصورة بدقة عالية", "Sound and picture in high definition") },
                    ]).map((fmt) => (
                      <button
                        key={fmt.type}
                        type="button"
                        onClick={() => setMediaType(fmt.type)}
                        disabled={phase === "converting"}
                        aria-pressed={mediaType === fmt.type}
                        className={cn(
                          "group relative overflow-hidden rounded-2xl border p-4 text-right transition-all duration-400",
                          mediaType === fmt.type
                            ? "border-[#e9a23b]/45 bg-gradient-to-br from-[#e9a23b]/12 to-transparent shadow-[0_0_28px_-8px_rgba(233,162,59,0.3)]"
                            : "border-white/8 bg-white/[0.025] hover:border-white/16 hover:bg-white/[0.045]"
                        )}
                      >
                        {mediaType === fmt.type && (
                          <motion.span
                            layoutId="fmt-glow"
                            className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#e9a23b]/70 to-transparent"
                          />
                        )}
                        <div className="flex items-start justify-between gap-2">
                          <fmt.icon
                            className={cn(
                              "h-6 w-6 transition-colors",
                              mediaType === fmt.type ? "text-[#f0c274]" : "text-muted-foreground group-hover:text-foreground"
                            )}
                            strokeWidth={1.8}
                          />
                          <span
                            className={cn(
                              "mt-0.5 h-4 w-4 rounded-full border-2 transition-all",
                              mediaType === fmt.type
                                ? "border-[#e9a23b] bg-[#e9a23b] shadow-[0_0_10px_rgba(233,162,59,0.6)]"
                                : "border-white/20"
                            )}
                          />
                        </div>
                        <div className="mt-3 font-display text-sm font-bold">{fmt.title}</div>
                        <div className="mt-1 text-[11.5px] leading-5 text-muted-foreground">{fmt.desc}</div>
                      </button>
                    ))}
                  </div>

                  {/* Quality pills */}
                  <div className="mt-4 grid grid-cols-4 gap-2">
                    {QUALITIES[mediaType].map((q) => (
                      <button
                        key={q.value}
                        type="button"
                        onClick={() => setQuality(q.value)}
                        disabled={phase === "converting"}
                        aria-pressed={quality === q.value}
                        className={cn(
                          "rounded-xl border px-2 py-2.5 text-center transition-all duration-300",
                          quality === q.value
                            ? "quality-chip-active border-[#e9a23b]/45 bg-[#e9a23b]/10"
                            : "border-white/8 bg-white/[0.02] hover:border-white/15"
                        )}
                      >
                        <div className={cn(
                          "font-mono text-[13px] font-bold transition-colors",
                          quality === q.value ? "text-[#f0c274]" : "text-foreground/85"
                        )}>
                          {q.label}
                        </div>
                        <div className="mt-0.5 text-[10px] font-medium text-muted-foreground">{tr(q.tag, q.tagEn)}</div>
                      </button>
                    ))}
                  </div>

                  {/* ---- Advanced: clip trimming ---- */}
                  <div className="mt-4">
                    <button
                      type="button"
                      onClick={() => setTrimOpen((v) => !v)}
                      disabled={phase === "converting"}
                      aria-expanded={trimOpen}
                      className={cn(
                        "group flex w-full items-center justify-between rounded-xl border px-4 py-3 text-right transition-all duration-300",
                        trimOpen
                          ? "border-[#e9a23b]/40 bg-[#e9a23b]/[0.07]"
                          : "border-white/8 bg-white/[0.02] hover:border-white/16 hover:bg-white/[0.04]"
                      )}
                    >
                      <span className="flex items-center gap-2.5">
                        <Scissors className={cn("h-4 w-4 transition-colors", trimOpen ? "text-[#f0c274]" : "text-muted-foreground group-hover:text-foreground")} />
                        <span className="text-[13px] font-bold">
                          {tr("قص مقطع محدد", "Trim a specific segment")}
                          {trim && <span className="mr-2 font-mono text-[11px] font-semibold text-[#f0c274]">({formatTime(trim.start)} → {formatTime(trim.end)})</span>}
                        </span>
                      </span>
                      <span className="flex items-center gap-2">
                        {trim && (
                          <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => { e.stopPropagation(); setTrimStartRaw(""); setTrimEndRaw("") }}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); setTrimStartRaw(""); setTrimEndRaw("") } }}
                            className="rounded-md px-2 py-1 text-[11px] font-bold text-muted-foreground transition-colors hover:bg-white/8 hover:text-foreground"
                          >
                            {tr("مسح", "Clear")}
                          </span>
                        )}
                        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform duration-300", trimOpen && "rotate-180")} />
                      </span>
                    </button>

                    <AnimatePresence initial={false}>
                      {trimOpen && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                          className="overflow-hidden"
                        >
                          <div className="trim-panel relative mt-3 rounded-xl border border-white/8 bg-black/25 p-4">
                            <CornerTicks className="opacity-60" />
                            <p className="mb-3 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                              <Timer className="h-3.5 w-3.5 text-[#e9a23b]/70" />
                              {tr("اسحب المقبضين الذهبيين على الشريط، أو اكتب النطاق بصيغة دقائق:ثواني (مثل 1:30).", "Drag the two golden handles on the track, or type the range as minutes:seconds (e.g. 1:30).")}
                            </p>

                            <div className="grid grid-cols-2 gap-3">
                              <label className="block">
                                <span className="mb-1.5 block text-[11px] font-bold text-muted-foreground">{tr("من (البداية)", "From (start)")}</span>
                                <input
                                  type="text"
                                  dir="ltr"
                                  inputMode="numeric"
                                  value={trimStartRaw}
                                  onChange={(e) => setTrimStartRaw(e.target.value)}
                                  placeholder="0:00"
                                  disabled={phase === "converting"}
                                  className="input-dark h-11 w-full rounded-xl text-center font-mono text-sm tracking-wide"
                                  aria-label={tr("بداية المقطع", "Clip start")}
                                />
                              </label>
                              <label className="block">
                                <span className="mb-1.5 block text-[11px] font-bold text-muted-foreground">{tr("إلى (النهاية)", "To (end)")}</span>
                                <input
                                  type="text"
                                  dir="ltr"
                                  inputMode="numeric"
                                  value={trimEndRaw}
                                  onChange={(e) => setTrimEndRaw(e.target.value)}
                                  placeholder={videoDuration ? formatTime(videoDuration) : "9:59"}
                                  disabled={phase === "converting"}
                                  className="input-dark h-11 w-full rounded-xl text-center font-mono text-sm tracking-wide"
                                  aria-label={tr("نهاية المقطع", "Clip end")}
                                />
                              </label>
                            </div>

                            {/* Interactive range visualization (RTL: 0:00 on the right edge) */}
                            {videoDuration > 0 && (
                              <div className="mt-5" dir="rtl">
                                <div
                                  ref={trimTrackRef}
                                  data-active={dragSide ? "true" : undefined}
                                  className={cn("trim-hit relative -my-1.5 flex h-9 w-full items-center py-1.5", phase === "converting" && "pointer-events-none opacity-60")}
                                  onPointerDown={(e) => {
                                    if ((e.target as HTMLElement).closest(".trim-handle")) return
                                    const t = posToTime(e.clientX)
                                    if (!trim) {
                                      const start = Math.max(0, Math.round(t))
                                      const end = Math.min(Math.round(videoDuration), start + 30)
                                      setTrimStartRaw(formatTime(start))
                                      setTrimEndRaw(formatTime(Math.max(start + 2, end)))
                                    } else {
                                      const dStart = Math.abs(t - trim.start)
                                      const dEnd = Math.abs(t - trim.end)
                                      commitDrag(dStart <= dEnd ? "start" : "end", t)
                                    }
                                  }}
                                >
                                  <div className="trim-track relative h-2.5 w-full overflow-hidden rounded-full">
                                    {!trim && <span className="trim-ghost absolute inset-0 rounded-full" aria-hidden="true" />}
                                    {trim && (
                                      <motion.span
                                        layout
                                        initial={false}
                                        className="trim-range absolute inset-y-0 rounded-full"
                                        style={{
                                          right: `${(trim.start / videoDuration) * 100}%`,
                                          width: `${((trim.end - trim.start) / videoDuration) * 100}%`,
                                        }}
                                      />
                                    )}
                                  </div>

                                  {/* Start handle (time 0 side — visual right in RTL) */}
                                  {(["start", "end"] as const).map((side) => {
                                    const value = side === "start" ? (trim?.start ?? 0) : (trim?.end ?? videoDuration)
                                    const pct = (value / videoDuration) * 100
                                    return (
                                      <span
                                        key={side}
                                        role="slider"
                                        tabIndex={phase === "converting" ? -1 : 0}
                                        aria-label={side === "start" ? tr("بداية المقطع (بالسحب أو الأسهم)", "Clip start (drag or arrow keys)") : tr("نهاية المقطع (بالسحب أو الأسهم)", "Clip end (drag or arrow keys)")}
                                        aria-valuemin={side === "start" ? 0 : Math.round((trim?.start ?? 0) + 2)}
                                        aria-valuemax={side === "end" ? Math.round(videoDuration) : Math.round((trim?.end ?? videoDuration) - 2)}
                                        aria-valuenow={Math.round(value)}
                                        aria-valuetext={formatTime(value)}
                                        aria-orientation="horizontal"
                                        data-dragging={dragSide === side ? "true" : undefined}
                                        className="trim-handle"
                                        style={{ right: `${pct}%` }}
                                        onPointerDown={(e) => {
                                          e.preventDefault()
                                          try {
                                            e.currentTarget.setPointerCapture(e.pointerId)
                                          } catch {
                                            /* synthetic/untrusted pointers cannot capture — drag still works via dragSide */
                                          }
                                          setDragSide(side)
                                        }}
                                        onPointerMove={(e) => {
                                          if (dragSide !== side && !e.currentTarget.hasPointerCapture(e.pointerId)) return
                                          commitDrag(side, posToTime(e.clientX))
                                        }}
                                        onPointerUp={(e) => {
                                          try {
                                            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                                              e.currentTarget.releasePointerCapture(e.pointerId)
                                            }
                                          } catch {
                                            /* ignore */
                                          }
                                          setDragSide(null)
                                        }}
                                        onPointerCancel={(e) => {
                                          try {
                                            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                                              e.currentTarget.releasePointerCapture(e.pointerId)
                                            }
                                          } catch {
                                            /* ignore */
                                          }
                                          setDragSide(null)
                                        }}
                                        onKeyDown={(e) => handleKeyDownTrim(side, e)}
                                      >
                                        <span className="trim-grip" aria-hidden="true" />
                                        <span className="trim-bubble font-mono" aria-hidden="true" dir="ltr">
                                          {formatTime(value)}
                                        </span>
                                      </span>
                                    )
                                  })}
                                </div>
                                <div className="mt-1 flex justify-between font-mono text-[10px] text-muted-foreground/60">
                                  <span>0:00</span>
                                  <span>{formatTime(videoDuration)}</span>
                                </div>
                              </div>
                            )}

                            <div className="mt-3 flex items-center justify-between text-[11.5px]">
                              {trimError ? (
                                <span className="font-semibold text-[#f0a8a5]" role="alert">{trimError}</span>
                              ) : trim ? (
                                <span className="font-semibold text-[#f0c274]">
                                  {tr("مدة المقطع:", "Clip duration:")} <span className="font-mono" dir="ltr">{formatTime(trim.end - trim.start)}</span>
                                </span>
                              ) : (
                                <span className="text-muted-foreground/70">{tr("لم يُحدد نطاق بعد — سيُحوَّل الفيديو كاملًا", "No range set yet — the full video will be converted")}</span>
                              )}
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Smart size estimate — warns before hitting the 80MB limit */}
                  {(() => {
                    const est = info ? estimateSizeMB(clipDuration || 0, mediaType, quality) : 0
                    if (est < 60) return null
                    const over = est >= MAX_MB
                    return (
                      <motion.div
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        role="status"
                        className={cn(
                          "mt-4 flex items-start gap-3 rounded-xl border p-3.5 text-[12px] leading-6",
                          over
                            ? "border-[#e5484d]/30 bg-[#e5484d]/8 text-[#f0a8a5]"
                            : "border-[#e9a23b]/25 bg-[#e9a23b]/8 text-[#f0c274]"
                        )}
                      >
                        <AlertTriangle className={cn("mt-0.5 h-4 w-4 shrink-0", over ? "text-[#f0554d]" : "text-[#f0c274]")} />
                        <p>
                          {over ? (
                            <>
                              {tr("الحجم المتوقع لهذه الجودة ", "Estimated size at this quality ")}
                              <b className="font-mono">~{Math.round(est)}MB</b>
                              {tr(" وقد يتجاوز الحد الأقصى ", " — this may exceed the ")}
                              <b className="font-mono">{MAX_MB}MB</b>
                              {tr(" — اختر جودة أقل لإتمام التحويل بنجاح.", " limit; pick a lower quality to complete the conversion.")}
                            </>
                          ) : (
                            <>
                              {tr("الحجم المتوقع ", "Estimated size ")}
                              <b className="font-mono">~{Math.round(est)}MB</b>
                              {tr(" — يقترب من الحد الأقصى ", " — approaching the ")}
                              <b className="font-mono">{MAX_MB}MB</b>
                              {tr("؛ راقب النتيجة أو اختر جودة أقل للفيديوهات الطويلة.", " limit; keep an eye on the result or pick a lower quality for long videos.")}
                            </>
                          )}
                        </p>
                      </motion.div>
                    )
                  })()}

                  {/* Convert button */}
                  <div className="mt-6">
                    {phase === "converting" ? (
                      <button
                        type="button"
                        onClick={cancelConvert}
                        className="inline-flex h-13 w-full items-center justify-center gap-2.5 rounded-2xl border border-[#e5484d]/30 bg-[#e5484d]/10 text-sm font-bold text-[#f0a8a5] transition-colors hover:bg-[#e5484d]/16"
                      >
                        <CircleX className="h-4.5 w-4.5" />
                        {tr("إلغاء التحويل", "Cancel conversion")}
                      </button>
                    ) : (
                      <div className="flex flex-col gap-2.5 sm:flex-row">
                        <button
                          type="button"
                          onClick={startConvert}
                          className="btn-gold btn-gold-cta shine group inline-flex h-13 flex-1 items-center justify-center gap-3 rounded-2xl text-base font-extrabold"
                        >
                          <Zap className="h-5 w-5 transition-transform duration-300 group-hover:scale-110" strokeWidth={2.5} />
                          {tr("إنشاء رابط ELMINYAWE", "Create your ELMINYAWE link")}
                          <span className="font-mono text-xs font-bold opacity-70">
                            {mediaType.toUpperCase()} · {quality}
                          </span>
                        </button>
                        <button
                          type="button"
                          onClick={addToBatch}
                          className="btn-ghost inline-flex h-13 items-center justify-center gap-2 rounded-2xl px-5 text-[13px] font-bold hover:border-[#e9a23b]/35 hover:bg-[#e9a23b]/10 hover:text-[#f0c274]"
                          aria-label={tr("أضف إلى قائمة الدفعات", "Add to the batch queue")}
                          title={tr("حوّل لاحقًا ضمن قائمة دفعات — روابط متعددة واحدًا تلو الآخر", "Convert later in a batch queue — multiple links, one after another")}
                        >
                          <ListPlus className="h-4.5 w-4.5" />
                          {tr("أضف للدفعة", "Add to batch")}
                        </button>
                      </div>
                    )}
                  </div>

                  <p className="mt-4 text-center text-[11.5px] leading-5 text-muted-foreground">
                    {tr(
                      "الحد الأقصى للملف 80MB · تبقى الصفحة مفتوحة أثناء التحويل · تُحذف الملفات المؤقتة فور اكتمال الطلب",
                      "80MB max file size · Keep this tab open during conversion · Temporary files are deleted the moment the request completes",
                    )}
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Convert error */}
            <AnimatePresence>
              {convertError && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="mt-4 flex flex-col gap-3 rounded-xl border border-[#e5484d]/25 bg-[#e5484d]/8 p-4 sm:flex-row sm:items-start" role="alert">
                    <AlertTriangle className="mt-0.5 h-4.5 w-4.5 shrink-0 text-[#f0554d]" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-6 text-[#f0a8a5]">{convertError}</p>
                      <p className="mt-1.5 text-[11.5px] leading-5 text-muted-foreground">
                        {tr("جرّب المحاولة مرة أخرى — قد ينجح محرك مختلف، أو استخدم فيديو آخر.", "Try again — a different engine may succeed, or use another video.")}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={startConvert}
                      className="btn-ghost inline-flex h-9 shrink-0 items-center gap-2 rounded-xl px-4 text-[12.5px] font-bold hover:border-[#e9a23b]/35 hover:bg-[#e9a23b]/10 hover:text-[#f0c274]"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      {tr("إعادة المحاولة", "Try again")}
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ===== CRT Terminal ===== */}
            <AnimatePresence>
              {phase === "converting" && (
                <motion.div
                  key="terminal"
                  initial={{ opacity: 0, y: 24, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -12, scale: 0.98 }}
                  transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                  className="mt-6"
                  role="status"
                  aria-live="polite"
                >
                  <div className="crt overflow-hidden rounded-2xl">
                    {/* Terminal header */}
                    <div className="flex items-center justify-between border-b border-[#e9a23b]/12 bg-black/30 px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="h-2.5 w-2.5 rounded-full bg-[#f0554d]/70" />
                        <span className="h-2.5 w-2.5 rounded-full bg-[#e9a23b]/70" />
                        <span className="h-2.5 w-2.5 rounded-full bg-[#2dd4a7]/70" />
                      </div>
                      <div className="flex items-center gap-2.5">
                        {activeEngine && (
                          <span
                            className="hidden rounded-md border border-[#e9a23b]/30 bg-[#e9a23b]/10 px-2 py-0.5 font-mono text-[10px] font-bold text-[#f0c274] sm:inline-block"
                            dir="ltr"
                          >
                            ⚙ {engineDisplayName(activeEngine, lang)}
                          </span>
                        )}
                        <span className="font-mono text-[11px] tracking-wider text-[#f0c274]/70">
                          ELMINYAWE://convert-engine
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="relative flex h-2 w-2">
                          <span className="absolute h-full w-full animate-ping rounded-full bg-[#2dd4a7] opacity-70" />
                          <span className="relative h-2 w-2 rounded-full bg-[#2dd4a7]" />
                        </span>
                        <span className="font-mono text-[10px] text-[#2dd4a7]/80">LIVE</span>
                      </div>
                    </div>
                    {/* Terminal body */}
                    <div ref={termBodyRef} className="max-h-56 overflow-y-auto px-4 py-3.5" dir="ltr">
                      {lines.map((line) => (
                        <div key={line.id} className="flex items-baseline gap-3 py-0.5 font-mono text-[12px] leading-5">
                          <span className="shrink-0 text-[#e9a23b]/40">[{line.time}]</span>
                          <span className={cn(
                            "shrink-0",
                            line.kind === "ok" ? "text-[#2dd4a7]" : line.kind === "warn" ? "text-[#f0554d]" : "text-[#e9a23b]/50"
                          )}>
                            {line.kind === "ok" ? "✓" : line.kind === "warn" ? "!" : "⟩"}
                          </span>
                          <span className={cn(
                            line.kind === "ok" ? "text-[#8ae6c8]" : line.kind === "warn" ? "text-[#f0a8a5]" : "crt-text"
                          )}>
                            {line.text}
                          </span>
                        </div>
                      ))}
                      <div className="py-0.5 font-mono text-[12px] leading-5">
                        <span className="crt-text animate-blink">▮</span>
                      </div>
                    </div>
                    {/* Progress bar */}
                    <div className="border-t border-[#e9a23b]/12 bg-black/30 px-4 py-3">
                      <div className="mb-2 flex items-center justify-between font-mono text-[11px]">
                        <span className="text-[#f0c274]/80">TRANSFERRING</span>
                        <span className="text-[#e9a23b]">{percent}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-white/5">
                        <div
                          className="progress-stripes h-full rounded-full bg-gradient-to-r from-[#b87a1e] via-[#e9a23b] to-[#ffd98e] transition-[width] duration-500 ease-out"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* ===== Done marker (result renders below) ===== */}
            <AnimatePresence>
              {result && (
                <motion.div
                  key="done-banner"
                  initial={{ opacity: 0, scale: 0.96 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="mt-6 flex flex-wrap items-center justify-center gap-2.5 rounded-2xl border border-[#2dd4a7]/25 bg-[#2dd4a7]/8 p-4"
                >
                  <CheckCircle2 className="h-5 w-5 text-[#2dd4a7]" />
                  <span className="text-sm font-bold text-[#8ae6c8]">
                    {tr("اكتمل التحويل بنجاح — رابطك جاهز بالأسفل", "Conversion completed successfully — your link is ready below")}
                  </span>
                  {result.engine && (
                    <span
                      className="rounded-md border border-[#e9a23b]/30 bg-[#e9a23b]/10 px-2 py-0.5 font-mono text-[10px] font-bold text-[#f0c274]"
                      dir="ltr"
                    >
                      ⚙ {engineName(result.engine, lang)} · {result.quality}
                    </span>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
