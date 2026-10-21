"use client"

import { useState, useRef, type CSSProperties } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Copy, Check, ExternalLink, Download, RotateCcw, Music4, Film,
  HardDrive, CloudUpload, Gauge, Code2, AudioLines, Cpu,
  Smartphone, Share2, MessageCircle, Send, Twitter, QrCode, Loader2, ImageDown,
  AlertTriangle,
} from "lucide-react"
import { toast } from "sonner"
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { useLang, engineDisplayName, storageLabel, absoluteLink } from "@/lib/i18n"
import { GoldEqualizer } from "./gold-equalizer"
import type { ConvertResult } from "./converter"

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function CopyButton({ text, label, className }: { text: string; label?: string; className?: string }) {
  const { tr } = useLang()
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        const ok = await copyText(text)
        if (ok) {
          setCopied(true)
          toast.success(tr("تم النسخ إلى الحافظة", "Copied to clipboard"))
          setTimeout(() => setCopied(false), 1600)
        } else {
          toast.error(tr("تعذّر النسخ", "Copy failed"))
        }
      }}
      className={cn(
        "btn-ghost shine inline-flex h-10 items-center gap-2 rounded-xl px-4 text-[13px] font-bold",
        className
      )}
      aria-label={label || tr("نسخ", "Copy")}
    >
      <AnimatePresence mode="wait" initial={false}>
        {copied ? (
          <motion.span key="check" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} className="inline-flex items-center gap-2 text-[#2dd4a7]">
            <Check className="h-4 w-4" strokeWidth={2.6} /> {tr("تم النسخ", "Copied")}
          </motion.span>
        ) : (
          <motion.span key="copy" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.5, opacity: 0 }} className="inline-flex items-center gap-2">
            <Copy className="h-4 w-4" /> {label || tr("نسخ", "Copy")}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  )
}

/* ---------------- QR dialog ---------------- */

function QrDialog({ directUrl, isAudio }: { directUrl: string; isAudio: boolean }) {
  const { lang, tr } = useLang()
  const [open, setOpen] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const qrSrc = `/api/qr?d=${encodeURIComponent(directUrl)}`

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); setLoaded(false) }}
        className="btn-ghost shine inline-flex h-10 items-center gap-2 rounded-xl px-4 text-[13px] font-bold"
        aria-label={tr("نقل الرابط إلى هاتفك عبر رمز QR", "Send the link to your phone with a QR code")}
      >
        <Smartphone className="h-4 w-4" />
        {tr("للهاتف", "To phone")}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          dir={lang === "ar" ? "rtl" : "ltr"}
          className="glass-deep max-w-sm rounded-3xl border-white/10 p-6 sm:p-8"
        >
          <DialogHeader className="items-center text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#e9a23b]/12">
              <QrCode className="h-6 w-6 text-[#f0c274]" strokeWidth={1.9} />
            </span>
            <DialogTitle className="font-display text-lg font-bold">
              {tr("انقل الرابط إلى", "Send the link to your")}{" "}
              <span className="text-gold-gradient">{tr("هاتفك", "phone")}</span>
            </DialogTitle>
            <DialogDescription className="text-[13px] leading-6 text-muted-foreground">
              {tr("وجّه كاميرا هاتفك نحو الرمز ليفتح رابط", "Point your phone's camera at the code to open the")
              }{" "}{isAudio ? tr("الصوت", "audio") : tr("الفيديو", "video")}{" "}
              {tr("مباشرةً — بدون كابلات ولا حسابات.", "link instantly — no cables, no accounts.")}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-2 flex flex-col items-center">
            <div className="relative rounded-2xl bg-[#fff8ea] p-4 shadow-[0_16px_40px_-12px_rgba(233,162,59,0.35)]">
              {!loaded && (
                <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-[#fff8ea]">
                  <Loader2 className="h-6 w-6 animate-spin text-[#b87a1e]" />
                </div>
              )}
              <img
                src={qrSrc}
                alt={tr(`رمز QR لرابط التحميل: ${directUrl}`, `QR code for the download link: ${directUrl}`)}
                width={192}
                height={192}
                loading="lazy"
                decoding="async"
                onLoad={() => setLoaded(true)}
                onError={() => toast.error(tr("تعذّر توليد رمز QR — حاول مجددًا", "Couldn't generate the QR code — please try again"))}
                className="h-48 w-48"
              />
            </div>

            <code dir="ltr" className="mt-4 max-w-full overflow-hidden break-all rounded-lg bg-black/40 px-3 py-2 font-mono text-[11px] leading-5 text-[#c9c4ba] line-clamp-2">
              {directUrl}
            </code>

            <a
              href={`${qrSrc}&format=png`}
              download="ELMINYAWE-qr.png"
              className="btn-ghost mt-4 inline-flex h-10 items-center gap-2 rounded-xl px-5 text-[13px] font-bold"
            >
              <Download className="h-4 w-4" />
              {tr("تنزيل صورة الرمز", "Download QR image")}
            </a>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

/* ---------------- Share row ---------------- */

function ShareRow({ directUrl, isAudio }: { directUrl: string; isAudio: boolean }) {
  const { tr } = useLang()
  const [open, setOpen] = useState(false)
  const shareText = encodeURIComponent(
    tr(
      `رابط ${isAudio ? "صوت MP3" : "فيديو MP4"} جاهز من ELMINYAWE ↓`,
      `${isAudio ? "MP3 audio" : "MP4 video"} link ready from ELMINYAWE ↓`
    )
  )
  const encodedUrl = encodeURIComponent(directUrl)
  const targets = [
    {
      key: "whatsapp",
      label: tr("واتساب", "WhatsApp"),
      icon: MessageCircle,
      href: `https://wa.me/?text=${shareText}%20${encodedUrl}`,
      hover: "hover:border-[#2dd4a7]/40 hover:bg-[#2dd4a7]/10 hover:text-[#8ae6c8]",
    },
    {
      key: "telegram",
      label: tr("تيليجرام", "Telegram"),
      icon: Send,
      href: `https://t.me/share/url?url=${encodedUrl}&text=${shareText}`,
      hover: "hover:border-[#5eb5f7]/40 hover:bg-[#5eb5f7]/10 hover:text-[#a5daff]",
    },
    {
      key: "x",
      label: "X",
      icon: Twitter,
      href: `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${shareText}`,
      hover: "hover:border-white/25 hover:bg-white/8 hover:text-white",
    },
  ]

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={tr("مشاركة الرابط", "Share the link")}
        className="btn-ghost shine inline-flex h-10 items-center gap-2 rounded-xl px-4 text-[13px] font-bold"
      >
        <Share2 className="h-4 w-4" />
        {tr("مشاركة", "Share")}
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.96 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="glass-deep absolute bottom-full left-0 z-50 mb-2 flex gap-1.5 rounded-2xl border-white/10 p-1.5"
              role="menu"
            >
              {targets.map((t) => (
                <a
                  key={t.key}
                  href={t.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  role="menuitem"
                  aria-label={tr(`مشاركة عبر ${t.label}`, `Share via ${t.label}`)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 text-[10.5px] font-bold text-muted-foreground transition-all duration-300",
                    t.hover
                  )}
                >
                  <t.icon className="h-4.5 w-4.5" strokeWidth={1.9} />
                  {t.label}
                </a>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

/* ---------------- Cover-art download ---------------- */

function CoverButton({ videoId, title }: { videoId?: string; title: string }) {
  const { tr } = useLang()
  const [loading, setLoading] = useState(false)
  if (!videoId) return null
  return (
    <button
      type="button"
      disabled={loading}
      onClick={async () => {
        setLoading(true)
        try {
          const res = await fetch(`/api/cover?videoId=${encodeURIComponent(videoId)}`)
          if (!res.ok) throw new Error(String(res.status))
          const blob = await res.blob()
          const href = URL.createObjectURL(blob)
          const a = document.createElement("a")
          a.href = href
          a.download = `ELMINYAWE-cover-${videoId}.jpg`
          document.body.appendChild(a)
          a.click()
          a.remove()
          setTimeout(() => URL.revokeObjectURL(href), 4000)
          toast.success(tr("تم تنزيل صورة الغلاف", "Cover art downloaded"))
        } catch {
          toast.error(tr("تعذّر تنزيل الغلاف — حاول مجددًا", "Couldn't download the cover — please try again"))
        } finally {
          setLoading(false)
        }
      }}
      className="btn-ghost shine inline-flex h-10 items-center gap-2 rounded-xl px-4 text-[13px] font-bold"
      aria-label={tr(`تنزيل صورة غلاف ${title}`, `Download the cover art for ${title}`)}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageDown className="h-4 w-4" />}
      {tr("الغلاف", "Cover")}
    </button>
  )
}

/* ---------------- Result card ---------------- */

/* One-time gold sparkle burst for the success header. Static values keep the
   burst deterministic across renders — it plays once on mount, then rests. */
const SPARKLE_BURST: Array<{ x: number; y: number; sx: number; sy: number; sd: number; del: number }> = [
  { x: 5, y: 30, sx: -36, sy: -48, sd: 1.6, del: 0.05 },
  { x: 13, y: 18, sx: -20, sy: -66, sd: 1.9, del: 0.14 },
  { x: 21, y: 34, sx: -6, sy: -36, sd: 1.3, del: 0 },
  { x: 29, y: 22, sx: 8, sy: -58, sd: 1.8, del: 0.2 },
  { x: 37, y: 32, sx: 20, sy: -42, sd: 1.4, del: 0.09 },
  { x: 45, y: 16, sx: 32, sy: -68, sd: 2, del: 0.26 },
  { x: 53, y: 28, sx: 40, sy: -30, sd: 1.5, del: 0.12 },
  { x: 61, y: 20, sx: -30, sy: -24, sd: 1.2, del: 0.17 },
  { x: 69, y: 34, sx: 14, sy: -26, sd: 1.7, del: 0.3 },
  { x: 77, y: 24, sx: 36, sy: -54, sd: 1.9, del: 0.34 },
]

export function Result({ result, onReset }: { result: ConvertResult; onReset: () => void }) {
  const { lang, tr } = useLang()
  /* The server-built result.directUrl carries a stale host — rebuild it from
     the browser's own origin so every link works on any domain we run on. */
  const directUrl = absoluteLink(result.directPath)
  const embedAudio = `<audio controls src="${directUrl}"></audio>`
  const embedVideo = `<video controls width="640" src="${directUrl}"></video>`
  const isAudio = result.type === "mp3"
  const audioRef = useRef<HTMLAudioElement | null>(null)
  /* v5.5 — a dead/unreachable link must never show as a silent 0:00 player:
   * surface a clear, actionable error the moment the element fails. */
  const [playFailed, setPlayFailed] = useState(false)
  const onPlayerError = () => setPlayFailed(true)

  return (
    <motion.div
      initial={{ opacity: 0, y: 36, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      className="mx-auto max-w-3xl px-4 sm:px-6"
    >
      <div className="glass-deep relative mt-8 overflow-hidden rounded-3xl p-5 sm:p-8">
        <div
          className="absolute inset-x-0 top-0 h-px"
          style={{ background: "linear-gradient(90deg, transparent 5%, rgba(45,212,167,0.5), transparent 95%)" }}
        />

        {/* Header */}
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          {/* One-time gold sparkle burst (plays once when the card mounts) */}
          {SPARKLE_BURST.map((s, i) => (
            <span
              key={i}
              className="sparkle"
              aria-hidden="true"
              style={{
                insetInlineStart: `${s.x}%`,
                top: `${s.y}px`,
                pointerEvents: "none",
                "--sx": `${s.sx}px`,
                "--sy": `${s.sy}px`,
                "--sd": `${s.sd}s`,
                "--sdel": `${s.del}s`,
              } as CSSProperties}
            />
          ))}
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#2dd4a7]/12">
                <Check className="h-4 w-4 text-[#2dd4a7]" strokeWidth={2.8} />
              </span>
              <h2 className="font-display text-lg font-bold sm:text-xl">
                {tr("رابط", "Your")} <span className="text-gold-gradient">ELMINYAWE</span> {tr("جاهز", "link is ready")}
              </h2>
            </div>
            <p className="mt-2 line-clamp-1 text-sm text-muted-foreground">{result.title}</p>
          </div>
          <button
            type="button"
            onClick={onReset}
            className="btn-ghost inline-flex h-10 items-center gap-2 rounded-xl px-4 text-[13px] font-bold"
          >
            <RotateCcw className="h-4 w-4" />
            {tr("تحويل جديد", "New conversion")}
          </button>
        </div>

        {/* Meta badges */}
        <div className="mt-5 flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[12px] font-semibold">
            {isAudio ? <Music4 className="h-3.5 w-3.5 text-[#f0c274]" /> : <Film className="h-3.5 w-3.5 text-[#f0c274]" />}
            {result.type.toUpperCase()}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 font-mono text-[12px] font-semibold">
            <Gauge className="h-3.5 w-3.5 text-[#f0c274]" />
            {result.quality || result.qualityRequested}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 font-mono text-[12px] font-semibold">
            <HardDrive className="h-3.5 w-3.5 text-[#f0c274]" />
            {result.sizeMB} MB
          </span>
          {result.engine && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-[#e9a23b]/25 bg-[#e9a23b]/8 px-3 py-1.5 font-mono text-[12px] font-semibold text-[#f0c274]"
              dir={lang === "ar" ? "rtl" : "ltr"}
            >
              <Cpu className="h-3.5 w-3.5" />
              {engineDisplayName(result.engine, lang)}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[12px] font-semibold">
            {result.storage === "catbox" ? (
              <>
                <CloudUpload className="h-3.5 w-3.5 text-[#2dd4a7]" />
                {storageLabel(result.storage, lang)}
              </>
            ) : (
              <>
                <HardDrive className="h-3.5 w-3.5 text-[#2dd4a7]" />
                {storageLabel(result.storage, lang)}
              </>
            )}
          </span>
        </div>

        {/* The golden link */}
        <div className="group relative mt-6">
          <div className="pointer-events-none absolute -inset-1 rounded-2xl bg-[#e9a23b]/12 opacity-0 blur-lg transition-opacity duration-700 group-hover:opacity-100" />
          <div className="link-pill relative flex flex-col gap-3 rounded-2xl border border-[#e9a23b]/25 bg-[#e9a23b]/[0.05] p-3 sm:flex-row sm:items-center">
            <div className="relative flex-1 overflow-x-auto">
              <div dir="ltr" className="flex items-center gap-2 px-2 py-2">
                <span className="shrink-0 font-mono text-[11px] font-bold tracking-wider text-[#e9a23b]/60">
                  LINK
                </span>
                <span className="h-4 w-px bg-[#e9a23b]/20" />
                <code className="whitespace-nowrap font-mono text-[13px] font-medium text-[#ffd98e]">
                  {directUrl}
                </code>
              </div>
            </div>
            <div className="flex flex-wrap shrink-0 items-center gap-1.5">
              <CopyButton text={directUrl} />
              <CoverButton videoId={result.videoId} title={result.title} />
              <QrDialog directUrl={directUrl} isAudio={isAudio} />
              <ShareRow directUrl={directUrl} isAudio={isAudio} />
              <a
                href={directUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-ghost inline-flex h-10 items-center gap-2 rounded-xl px-4 text-[13px] font-bold"
              >
                <ExternalLink className="h-4 w-4" />
                {tr("فتح", "Open")}
              </a>
              <a
                href={`${directUrl}${directUrl.includes("?") ? "&" : "?"}download=1`}
                className="btn-gold shine mr-1 inline-flex h-10 items-center gap-2 rounded-xl px-5 text-[13px] font-bold"
              >
                <Download className="h-4 w-4" strokeWidth={2.4} />
                {tr("تنزيل", "Download")}
              </a>
            </div>
          </div>
        </div>

        {/* Player */}
        <div className="mt-7">
          <div className="mb-3 flex items-center gap-2 text-[13px] font-bold text-muted-foreground">
            <AudioLines className="h-4 w-4 text-[#f0c274]" />
            {tr("معاينة مباشرة", "Live preview")}
          </div>
          <div className="overflow-hidden rounded-2xl border border-white/8 bg-black/60">
            {playFailed ? (
              <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#e5484d]/12">
                  <AlertTriangle className="h-5 w-5 text-[#e5484d]" />
                </span>
                <p className="max-w-md text-sm font-semibold text-foreground/90">
                  {tr(
                    "تعذّر تشغيل المعاينة — الرابط لم يستجب. جرّب «فتح الرابط» أو «تنزيل»، وإن استمر الخطأ أعد التحويل للحصول على رابط جديد.",
                    "Preview failed to load — the link did not respond. Try “Open link” or “Download”; if it keeps failing, re-convert to get a fresh link."
                  )}
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  <a
                    href={directUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn-ghost inline-flex h-9 items-center gap-2 rounded-lg px-4 text-[12px] font-bold"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {tr("فتح الرابط", "Open link")}
                  </a>
                  <button
                    type="button"
                    onClick={onReset}
                    className="btn-gold inline-flex h-9 items-center gap-2 rounded-lg px-4 text-[12px] font-bold"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    {tr("إعادة التحويل", "Re-convert")}
                  </button>
                </div>
              </div>
            ) : isAudio ? (
              <div className="relative p-5">
                {result.thumbnail && (
                  <div className="pointer-events-none absolute inset-0 opacity-20" aria-hidden="true">
                    <img src={result.thumbnail} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover blur-2xl saturate-150" />
                  </div>
                )}
                <div className="relative flex items-center gap-4">
                  <GoldEqualizer audioRef={audioRef} />
                  <audio ref={audioRef} controls preload="metadata" src={directUrl} onError={onPlayerError} className="relative w-full">
                    {tr("متصفحك لا يدعم تشغيل الصوت.", "Your browser doesn't support audio playback.")}
                  </audio>
                </div>
              </div>
            ) : (
              <video controls preload="metadata" src={directUrl} onError={onPlayerError} className="aspect-video w-full">
                {tr("متصفحك لا يدعم تشغيل الفيديو.", "Your browser doesn't support video playback.")}
              </video>
            )}
          </div>
        </div>

        {/* Embed snippets */}
        <div className="mt-7">
          <div className="mb-3 flex items-center gap-2 text-[13px] font-bold text-muted-foreground">
            <Code2 className="h-4 w-4 text-[#f0c274]" />
            {tr("تضمين الرابط في موقعك", "Embed the link on your site")}
          </div>
          <div className="space-y-2.5">
            {[
              { label: tr("مشغّل صوت", "Audio player"), code: embedAudio },
              { label: tr("مشغّل فيديو", "Video player"), code: embedVideo },
            ].map((snippet) => (
              <div key={snippet.label} className="flex flex-col gap-2 rounded-xl border border-white/8 bg-black/45 p-3 sm:flex-row sm:items-center">
                <span className="shrink-0 text-[12px] font-bold text-muted-foreground sm:w-24">{snippet.label}</span>
                <code dir="ltr" className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg bg-black/40 px-3 py-2 font-mono text-[11.5px] text-[#c9c4ba]">
                  {snippet.code}
                </code>
                <CopyButton text={snippet.code} label={tr("نسخ", "Copy")} className="h-9 shrink-0 px-3 text-[12px]" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </motion.div>
  )
}
