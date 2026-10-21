"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Music4, Film, ExternalLink, History as HistoryIcon, Sparkles, Cpu,
  Trash2, Loader2, Link2, Search, X, Copy, Check, Download, QrCode, Share2,
  MessageCircle, Send, Twitter, FileJson, RotateCcw, AlertTriangle,
} from "lucide-react"
import { toast } from "sonner"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { useLang, engineDisplayName, absoluteLink, type Lang } from "@/lib/i18n"
import { useAdminStore, authFetch } from "@/lib/admin-store"
import { GoldEqualizer } from "./gold-equalizer"
import { Insights } from "./insights"

interface HistoryItem {
  id: string
  title: string
  ext: string
  quality: string
  engine?: string
  sizeMB: number
  thumbnail: string | null
  videoId?: string | null
  path: string
  createdAt: string
}

/** Ask the converter to re-run this conversion with the same settings. */
function reconvert(item: HistoryItem, lang: Lang) {
  if (!item.videoId) {
    toast.error(lang === "en" ? "No video ID available for this item" : "لا يتوفر معرّف الفيديو لهذا العنصر")
    return
  }
  window.dispatchEvent(
    new CustomEvent("elminyawe:reconvert", {
      detail: {
        url: `https://www.youtube.com/watch?v=${item.videoId}`,
        type: item.ext === "mp4" ? "mp4" : "mp3",
        quality: item.quality,
      },
    })
  )
}

type TypeFilter = "all" | "mp3" | "mp4"

function timeAgo(iso: string, lang: Lang): string {
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return lang === "en" ? "just now" : "الآن"
  if (minutes < 60) return lang === "en" ? `${minutes} min ago` : `قبل ${minutes} دقيقة`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return lang === "en" ? `${hours} h ago` : `قبل ${hours} ساعة`
  const days = Math.floor(hours / 24)
  if (days < 30) return lang === "en" ? `${days} d ago` : `قبل ${days} يوم`
  return new Date(iso).toLocaleDateString(lang === "en" ? "en-GB" : "ar-EG")
}

/* ---------------- Preview modal ---------------- */

function PreviewActions({ item }: { item: HistoryItem }) {
  const { lang, tr } = useLang()
  const [copied, setCopied] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [qrOpen, setQrOpen] = useState(false)
  const directUrl = absoluteLink(item.path)
  const isAudio = item.ext === "mp3"
  const qrSrc = `/api/qr?d=${encodeURIComponent(directUrl)}`

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(directUrl)
      setCopied(true)
      toast.success(tr("تم نسخ الرابط", "Link copied"))
      setTimeout(() => setCopied(false), 1600)
    } catch {
      toast.error(tr("تعذّر النسخ", "Copy failed"))
    }
  }

  const shareText = encodeURIComponent(
    tr(
      `رابط ${isAudio ? "صوت MP3" : "فيديو MP4"} جاهز من ELMINYAWE ↓`,
      `${isAudio ? "MP3 audio" : "MP4 video"} link ready from ELMINYAWE ↓`
    )
  )
  const encodedUrl = encodeURIComponent(directUrl)
  const shareTargets = [
    { key: "wa", icon: MessageCircle, label: tr("واتساب", "WhatsApp"), href: `https://wa.me/?text=${shareText}%20${encodedUrl}`, hover: "hover:border-[#2dd4a7]/40 hover:bg-[#2dd4a7]/10 hover:text-[#8ae6c8]" },
    { key: "tg", icon: Send, label: tr("تيليجرام", "Telegram"), href: `https://t.me/share/url?url=${encodedUrl}&text=${shareText}`, hover: "hover:border-[#5eb5f7]/40 hover:bg-[#5eb5f7]/10 hover:text-[#a5daff]" },
    { key: "x", icon: Twitter, label: "X", href: `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${shareText}`, hover: "hover:border-white/25 hover:bg-white/8 hover:text-white" },
  ]

  return (
    <>
      {/* Actions */}
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => reconvert(item, lang)}
                className="btn-ghost shine inline-flex h-10 items-center gap-2 rounded-xl px-4 text-[13px] font-bold text-[#f0c274]"
                aria-label={tr(`إعادة تحويل ${item.title} بنفس الإعدادات`, `Re-convert ${item.title} with the same settings`)}
              >
                <RotateCcw className="h-4 w-4" />
                {tr("إعادة التحويل", "Re-convert")}
              </button>
              <button
                type="button"
                onClick={copyLink}
                className="btn-ghost shine inline-flex h-10 items-center gap-2 rounded-xl px-4 text-[13px] font-bold"
              >
                {copied ? <Check className="h-4 w-4 text-[#2dd4a7]" /> : <Copy className="h-4 w-4" />}
                {copied ? tr("تم النسخ", "Copied") : tr("نسخ الرابط", "Copy link")}
              </button>
              <button
                type="button"
                onClick={() => setQrOpen((v) => !v)}
                className="btn-ghost inline-flex h-10 items-center gap-2 rounded-xl px-4 text-[13px] font-bold"
                aria-label={tr("رمز QR", "QR code")}
              >
                <QrCode className="h-4 w-4" />
                QR
              </button>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShareOpen((v) => !v)}
                  aria-expanded={shareOpen}
                  className="btn-ghost inline-flex h-10 items-center gap-2 rounded-xl px-4 text-[13px] font-bold"
                >
                  <Share2 className="h-4 w-4" />
                  {tr("مشاركة", "Share")}
                </button>
                <AnimatePresence>
                  {shareOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShareOpen(false)} aria-hidden="true" />
                      <motion.div
                        initial={{ opacity: 0, y: 8, scale: 0.96 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 8, scale: 0.96 }}
                        transition={{ duration: 0.25 }}
                        className="glass-deep absolute bottom-full right-0 z-50 mb-2 flex gap-1.5 rounded-2xl border-white/10 p-1.5"
                        role="menu"
                      >
                        {shareTargets.map((t) => (
                          <a
                            key={t.key}
                            href={t.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            role="menuitem"
                            aria-label={tr(`مشاركة عبر ${t.label}`, `Share via ${t.label}`)}
                            className={cn(
                              "flex flex-col items-center gap-1 rounded-xl border border-white/8 bg-white/[0.03] px-4 py-2.5 text-[10.5px] font-bold text-muted-foreground transition-all duration-300",
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

            {/* Inline QR */}
            <AnimatePresence>
              {qrOpen && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="mt-4 flex items-center gap-4 rounded-2xl border border-white/8 bg-black/30 p-4">
                    <div className="shrink-0 rounded-xl bg-[#fff8ea] p-2.5 shadow-[0_12px_32px_-10px_rgba(233,162,59,0.35)]">
                      <img src={qrSrc} alt={tr(`رمز QR لرابط: ${item.title}`, `QR code for: ${item.title}`)} width={128} height={128} loading="lazy" decoding="async" className="h-32 w-32" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] font-bold">{tr("وجّه كاميرا هاتفك نحو الرمز", "Point your phone's camera at the code")}</p>
                      <p className="mt-1 break-all text-[11px] leading-5 text-muted-foreground" dir="ltr">{directUrl}</p>
                      <a
                        href={`${qrSrc}&format=png`}
                        download="ELMINYAWE-qr.png"
                        className="mt-2 inline-flex items-center gap-1.5 text-[11.5px] font-bold text-[#f0c274] transition-colors hover:text-[#ffd98e]"
                      >
                        <Download className="h-3 w-3" />
                        {tr("تنزيل صورة الرمز PNG", "Download QR image (PNG)")}
                      </a>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
    </>
  )
}

function PreviewModal({ item, onClose }: { item: HistoryItem | null; onClose: () => void }) {
  const { lang, tr, isRTL } = useLang()
  const isAudio = item?.ext === "mp3"
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const directUrl = absoluteLink(item?.path)
  /* v5.5 — expired/unreachable links show a clear error card, never a
   * silent 0:00 player (the old L-key links die with their instance).
   * State resets when the previewed item changes (render-time reset —
   * the recommended pattern, no effect needed). */
  const [playFailed, setPlayFailed] = useState(false)
  const prevItemIdRef = useRef<string | null>(null)
  const currentId = item?.id ?? null
  if (prevItemIdRef.current !== currentId) {
    prevItemIdRef.current = currentId
    if (playFailed) setPlayFailed(false)
  }
  return (
    <Dialog open={!!item} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        dir={lang === "ar" ? "rtl" : "ltr"}
        className="glass-deep max-w-2xl rounded-3xl border-white/10 p-5 sm:p-7"
      >
        {item && (
          <div key={item.id}>
            <DialogHeader className={isRTL ? "text-right" : "text-left"}>
              <div className="flex items-center gap-2.5">
                <span className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-lg",
                  isAudio ? "bg-[#e9a23b]/12" : "bg-[#2dd4a7]/12"
                )}>
                  {isAudio ? <Music4 className="h-4 w-4 text-[#f0c274]" /> : <Film className="h-4 w-4 text-[#2dd4a7]" />}
                </span>
                <DialogTitle className="font-display text-base font-bold leading-7 sm:text-lg">
                  {item.title}
                </DialogTitle>
              </div>
              <DialogDescription className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px]">
                <span className="font-mono">{item.quality}</span>
                <span className="font-mono">{item.sizeMB} MB</span>
                <span>{timeAgo(item.createdAt, lang)}</span>
                {item.engine && (
                  <span className="inline-flex items-center gap-1 rounded border border-[#e9a23b]/25 bg-[#e9a23b]/8 px-1.5 py-0.5 font-mono text-[9.5px] font-bold text-[#f0c274]/90" dir={isRTL ? "rtl" : "ltr"}>
                    <Cpu className="h-2.5 w-2.5" />
                    {engineDisplayName(item.engine, lang)}
                  </span>
                )}
              </DialogDescription>
            </DialogHeader>

            {/* Inline player */}
            <div className="mt-4 overflow-hidden rounded-2xl border border-white/8 bg-black/60">
              {playFailed ? (
                <div className="flex flex-col items-center gap-2 px-6 py-7 text-center">
                  <AlertTriangle className="h-5 w-5 text-[#e5484d]" />
                  <p className="max-w-sm text-[13px] font-semibold text-foreground/90">
                    {tr(
                      "تعذّر تشغيل هذا الملف — الرابط منتهٍ أو غير متاح حاليًا. أعد التحويل للحصول على رابط جديد دائم.",
                      "This file could not be played — the link is expired or temporarily unavailable. Re-convert to get a fresh permanent link."
                    )}
                  </p>
                </div>
              ) : isAudio ? (
                <div className="relative p-5">
                  {item.thumbnail && (
                    <div className="pointer-events-none absolute inset-0 opacity-25" aria-hidden="true">
                      <img src={item.thumbnail} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover blur-xl saturate-150" />
                    </div>
                  )}
                  <div className="relative flex items-center gap-4">
                    <GoldEqualizer audioRef={audioRef} />
                    {/* No autoPlay: opening a preview must not stream the whole
                        file — playback starts on the user's explicit click. */}
                    <audio ref={audioRef} controls preload="metadata" src={directUrl} onError={() => setPlayFailed(true)} className="relative w-full">
                      {tr("متصفحك لا يدعم تشغيل الصوت.", "Your browser doesn't support audio playback.")}
                    </audio>
                  </div>
                </div>
              ) : (
                /* No autoPlay — explicit click only (bandwidth hygiene). */
                <video controls preload="metadata" src={directUrl} poster={item.thumbnail || undefined} onError={() => setPlayFailed(true)} className="aspect-video w-full">
                  {tr("متصفحك لا يدعم تشغيل الفيديو.", "Your browser doesn't support video playback.")}
                </video>
              )}
            </div>

            {/* Copy / QR / share / open / download — keyed so state resets per item */}
            <PreviewActions item={item} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

/* ---------------- Section ---------------- */

export function HistorySection({ refreshKey }: { refreshKey: number }) {
  const { lang, tr, isRTL } = useLang()
  const adminAuthed = useAdminStore((s) => s.authed)
  const openAdminPanel = useAdminStore((s) => s.openPanel)
  const refreshAdmin = useAdminStore((s) => s.refresh)
  const setAdminAuthed = useAdminStore((s) => s.setAuthed)
  const [items, setItems] = useState<HistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [clearing, setClearing] = useState(false)
  const [query, setQuery] = useState("")
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all")
  const [preview, setPreview] = useState<HistoryItem | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/history?limit=10")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data.ok) setItems(data.items || [])
      })
      .catch(() => {})
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  /* Check the admin session once so delete buttons know their gate state. */
  useEffect(() => {
    if (adminAuthed === null) refreshAdmin()
  }, [adminAuthed, refreshAdmin])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((it) => {
      if (typeFilter !== "all" && it.ext !== typeFilter) return false
      if (q && !it.title.toLowerCase().includes(q)) return false
      return true
    })
  }, [items, query, typeFilter])

  /** Deletion is admin-only — visitors get the hidden login instead. */
  const requireAdmin = (): boolean => {
    if (adminAuthed) return true
    openAdminPanel()
    toast.info(
      tr("المسح متاح لمشرف الموقع فقط — سجّل الدخول من اللوحة", "Deletion is admin-only — sign in from the panel")
    )
    return false
  }

  const deleteOne = async (id: string) => {
    if (!requireAdmin()) return
    setDeletingId(id)
    try {
      const res = await authFetch(`/api/history?id=${encodeURIComponent(id)}`, { method: "DELETE" })
      if (res.status === 401) {
        setAdminAuthed(false)
        requireAdmin()
        return
      }
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || tr("تعذّر الحذف", "Delete failed"))
      setItems((prev) => prev.filter((it) => it.id !== id))
      if (preview?.id === id) setPreview(null)
      toast.success(tr("أُزيل العنصر من السجل", "Item removed from history"))
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setDeletingId(null)
    }
  }

  const clearAll = async () => {
    if (!requireAdmin()) return
    setClearing(true)
    try {
      const res = await authFetch("/api/history?all=1", { method: "DELETE" })
      if (res.status === 401) {
        setAdminAuthed(false)
        requireAdmin()
        return
      }
      const data = await res.json()
      if (!data.ok) throw new Error(data.error || tr("تعذّر المسح", "Couldn't clear the history"))
      setItems([])
      setPreview(null)
      toast.success(tr(`تم مسح السجل (${data.deleted} عنصر)`, `History cleared (${data.deleted} ${data.deleted === 1 ? "item" : "items"})`))
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setClearing(false)
    }
  }

  /* Copy every (filtered) link to the clipboard, one per line */
  const copyAllLinks = async () => {
    const links = filtered.map((it) => absoluteLink(it.path))
    if (!links.length) return
    try {
      await navigator.clipboard.writeText(links.join("\n"))
      toast.success(tr(`تم نسخ ${links.length} رابطًا إلى الحافظة`, `Copied ${links.length} ${links.length === 1 ? "link" : "links"} to the clipboard`))
    } catch {
      toast.error(tr("تعذّر النسخ إلى الحافظة", "Couldn't copy to the clipboard"))
    }
  }

  /* Download the full history as a branded JSON backup */
  const exportJson = () => {
    const payload = {
      brand: "ELMINYAWE",
      exportedAt: new Date().toISOString(),
      count: filtered.length,
      items: filtered.map((it) => ({
        title: it.title,
        format: it.ext.toUpperCase(),
        quality: it.quality,
        engine: it.engine ? engineDisplayName(it.engine, lang) : null,
        sizeMB: it.sizeMB,
        url: absoluteLink(it.path),
        createdAt: it.createdAt,
      })),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
    const href = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = href
    a.download = `elminyawe-history-${new Date().toISOString().slice(0, 10)}.json`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(href)
    toast.success(tr(`تم تصدير ${filtered.length} عنصرًا بصيغة JSON`, `Exported ${filtered.length} ${filtered.length === 1 ? "item" : "items"} as JSON`))
  }

  const showFilterBar = !loading && items.length > 0

  if (!loading && items.length === 0) return null

  const counts = {
    all: items.length,
    mp3: items.filter((it) => it.ext === "mp3").length,
    mp4: items.filter((it) => it.ext === "mp4").length,
  }

  return (
    <section id="history" className="relative py-16 sm:py-20">
      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-60px" }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        >
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03]">
                <HistoryIcon className="h-5 w-5 text-[#f0c274]" strokeWidth={1.8} />
              </span>
              <div>
                <h2 className="font-display text-xl font-bold sm:text-2xl">{tr("آخر التحويلات", "Recent conversions")}</h2>
                <div className="ornament mt-2.5 justify-start" aria-hidden="true">
                  <span className="ornament-diamond" />
                </div>
                <p className="mt-2 text-[13px] text-muted-foreground">{tr("ملفات حقيقية جاهزة للتشغيل الفوري", "Real files, ready to play instantly")}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="hidden items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 sm:flex">
                <Sparkles className="h-3.5 w-3.5 text-[#e9a23b]/70" />
                <span className="font-mono text-[11px] text-muted-foreground">{items.length} {tr("ملف", items.length === 1 ? "file" : "files")}</span>
              </div>
              <button
                type="button"
                onClick={copyAllLinks}
                disabled={filtered.length === 0}
                className="btn-ghost inline-flex h-9 items-center gap-2 rounded-xl px-3.5 text-[12px] font-bold"
                aria-label={tr("نسخ كل الروابط الظاهرة", "Copy all visible links")}
              >
                <Link2 className="h-3.5 w-3.5" />
                {tr("نسخ الروابط", "Copy links")}
              </button>
              <button
                type="button"
                onClick={exportJson}
                disabled={filtered.length === 0}
                className="btn-ghost inline-flex h-9 items-center gap-2 rounded-xl px-3.5 text-[12px] font-bold"
                aria-label={tr("تصدير السجل بصيغة JSON", "Export the history as JSON")}
              >
                <FileJson className="h-3.5 w-3.5" />
                {tr("تصدير JSON", "Export JSON")}
              </button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <button
                    type="button"
                    disabled={clearing || items.length === 0}
                    className="btn-ghost inline-flex h-9 items-center gap-2 rounded-xl px-3.5 text-[12px] font-bold text-[#f0a8a5] hover:border-[#e5484d]/35 hover:bg-[#e5484d]/10"
                    aria-label={tr("مسح كل السجل", "Clear the entire history")}
                  >
                    {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    {tr("مسح الكل", "Clear all")}
                  </button>
                </AlertDialogTrigger>
                <AlertDialogContent
                  dir={lang === "ar" ? "rtl" : "ltr"}
                  className="glass-deep rounded-3xl border-white/10"
                >
                  <AlertDialogHeader>
                    <AlertDialogTitle className="font-display">{tr("مسح سجل التحويلات بالكامل؟", "Clear the entire conversion history?")}</AlertDialogTitle>
                    <AlertDialogDescription className="leading-6">
                      {tr(
                        "سيُحذف السجل من قاعدة البيانات وتُحذف الملفات المخزَّنة محليًا من الخادم. الملفات المرفوعة على التخزين الخارجي تبقى متاحة عبر روابطها المباشرة.",
                        "The history will be deleted from the database and locally stored files will be removed from the server. Files on external storage remain available through their direct links."
                      )}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter className="gap-2 sm:gap-0">
                    <AlertDialogCancel className="btn-ghost rounded-xl font-bold">{tr("تراجع", "Cancel")}</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={(e) => {
                        e.preventDefault()
                        clearAll()
                      }}
                      className="rounded-xl border border-[#e5484d]/40 bg-[#e5484d]/15 font-bold text-[#f0a8a5] hover:bg-[#e5484d]/25 hover:text-[#f5c1be]"
                    >
                      {tr("نعم، امسح الكل", "Yes, clear everything")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>

          {/* Insights: weekly activity + engines distribution */}
          <Insights refreshKey={refreshKey} />

          {/* Search + type filter */}
          {showFilterBar && (
            <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="group relative w-full sm:max-w-xs">
                <Search className={cn(
                  "pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60",
                  isRTL ? "right-3.5" : "left-3.5"
                )} />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={tr("ابحث في سجلك بالعنوان...", "Search your history by title...")}
                  aria-label={tr("البحث في سجل التحويلات", "Search your conversion history")}
                  className={cn(
                    "input-dark h-11 w-full rounded-xl py-2 text-[13px] placeholder:font-sans [&::-webkit-search-cancel-button]:hidden",
                    isRTL ? "pr-10 pl-9" : "pl-10 pr-9"
                  )}
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className={cn(
                      "absolute top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-white/8 hover:text-foreground",
                      isRTL ? "left-2.5" : "right-2.5"
                    )}
                    aria-label={tr("مسح البحث", "Clear search")}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.02] p-1" role="tablist" aria-label={tr("تصفية حسب النوع", "Filter by type")}>
                {([
                  { key: "all" as TypeFilter, label: tr("الكل", "All"), count: counts.all },
                  { key: "mp3" as TypeFilter, label: "MP3", count: counts.mp3 },
                  { key: "mp4" as TypeFilter, label: "MP4", count: counts.mp4 },
                ]).map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={typeFilter === tab.key}
                    onClick={() => setTypeFilter(tab.key)}
                    className={cn(
                      "inline-flex h-9 items-center gap-1.5 rounded-lg px-3.5 text-[12px] font-bold transition-all duration-300",
                      typeFilter === tab.key
                        ? "bg-[#e9a23b]/15 text-[#f0c274] shadow-[inset_0_0_0_1px_rgba(233,162,59,0.3)]"
                        : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
                    )}
                  >
                    {tab.key === "mp3" && <Music4 className="h-3.5 w-3.5" />}
                    {tab.key === "mp4" && <Film className="h-3.5 w-3.5" />}
                    {tab.label}
                    <span className={cn(
                      "rounded-full px-1.5 py-0.5 font-mono text-[9.5px]",
                      typeFilter === tab.key ? "bg-[#e9a23b]/20 text-[#f0c274]" : "bg-white/6 text-muted-foreground"
                    )} dir="ltr">
                      {tab.count}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Grid */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {(loading ? Array.from({ length: 4 }) : filtered).map((item, i) => {
              if (!item) {
                return (
                  <div key={i} className="glass overflow-hidden rounded-2xl">
                    <div className="skeleton-shimmer aspect-video w-full" />
                    <div className="space-y-2 p-4">
                      <div className="skeleton-shimmer h-4 w-3/4 rounded" />
                      <div className="skeleton-shimmer h-3 w-1/2 rounded" />
                    </div>
                  </div>
                )
              }
              const it = item as HistoryItem
              return (
                <motion.div
                  key={it.id}
                  layout
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.94 }}
                  transition={{ delay: Math.min(i * 0.06, 0.3), duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
                  className="history-card glass glass-hover group relative block cursor-pointer overflow-hidden rounded-2xl"
                  onClick={() => setPreview(it)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      setPreview(it)
                    }
                  }}
                  aria-label={tr(`معاينة ${it.title}`, `Preview ${it.title}`)}
                >
                  <div className="relative aspect-video overflow-hidden">
                    {it.thumbnail ? (
                      <img
                        src={it.thumbnail}
                        alt={it.title}
                        className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-108"
                        loading="lazy"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-white/[0.02]">
                        {it.ext === "mp3" ? <Music4 className="h-8 w-8 text-muted-foreground" /> : <Film className="h-8 w-8 text-muted-foreground" />}
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                    {/* Play affordance on hover */}
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-all duration-400 group-hover:opacity-100">
                      <span className="flex h-14 w-14 scale-75 items-center justify-center rounded-full border border-[#e9a23b]/40 bg-black/55 backdrop-blur-md transition-transform duration-400 group-hover:scale-100">
                        <svg viewBox="0 0 24 24" className="h-6 w-6 -scale-x-100 fill-[#ffd98e] ml-1" aria-hidden="true">
                          <path d="M8 5.14v13.72c0 .8.87 1.3 1.56.9l10.5-6.86a1.05 1.05 0 000-1.8L9.56 4.24A1.05 1.05 0 008 5.14z" />
                        </svg>
                      </span>
                    </div>
                    <div className="absolute bottom-2.5 right-2.5 flex items-center gap-1.5">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-[10px] font-bold backdrop-blur-sm",
                          it.ext === "mp3" ? "bg-[#e9a23b]/85 text-black" : "bg-[#2dd4a7]/85 text-black"
                        )}
                      >
                        {it.ext === "mp3" ? <Music4 className="h-3 w-3" /> : <Film className="h-3 w-3" />}
                        {it.ext.toUpperCase()}
                      </span>
                      <span className="rounded-md bg-black/75 px-2 py-0.5 font-mono text-[10px] font-bold text-white/90 backdrop-blur-sm">
                        {it.quality}
                      </span>
                    </div>
                  </div>
                  <div className="p-4">
                    <h3 className="line-clamp-2 min-h-[2.6em] text-[13px] font-bold leading-[1.35]">{it.title}</h3>
                    <div className="mt-2.5 flex items-center justify-between text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-2">
                        <span className="font-mono">{it.sizeMB} MB</span>
                        {it.engine && (
                          <span
                            className="inline-flex items-center gap-1 rounded border border-[#e9a23b]/25 bg-[#e9a23b]/8 px-1.5 py-0.5 font-mono text-[9.5px] font-bold text-[#f0c274]/90"
                            dir={isRTL ? "rtl" : "ltr"}
                          >
                            <Cpu className="h-2.5 w-2.5" />
                            {engineDisplayName(it.engine, lang)}
                          </span>
                        )}
                      </span>
                      <span>{timeAgo(it.createdAt, lang)}</span>
                    </div>
                  </div>

                  {/* Per-item actions: re-convert + delete (visible on hover) */}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      reconvert(it, lang)
                    }}
                    className="absolute left-11 bottom-2.5 z-10 flex h-8 w-8 items-center justify-center rounded-lg border border-[#e9a23b]/30 bg-black/70 text-[#f0c274]/80 opacity-100 backdrop-blur-md transition-all duration-300 hover:border-[#e9a23b]/60 hover:bg-[#e9a23b]/20 hover:text-[#ffd98e] focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                    aria-label={tr(`إعادة تحويل ${it.title}`, `Re-convert ${it.title}`)}
                    title={tr("إعادة التحويل بنفس الإعدادات", "Re-convert with the same settings")}
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      deleteOne(it.id)
                    }}
                    disabled={deletingId === it.id}
                    className="absolute left-2.5 bottom-2.5 z-10 flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-black/70 text-muted-foreground opacity-100 backdrop-blur-md transition-all duration-300 hover:border-[#e5484d]/40 hover:bg-[#e5484d]/20 hover:text-[#f0a8a5] focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                    aria-label={tr(`إزالة ${it.title} من السجل`, `Remove ${it.title} from history`)}
                  >
                    {deletingId === it.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </button>
                </motion.div>
              )
            })}
          </div>

          {/* No results */}
          {!loading && filtered.length === 0 && items.length > 0 && (
            <div className="glass flex flex-col items-center gap-3 rounded-2xl px-6 py-12 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03]">
                <Search className="h-5 w-5 text-muted-foreground" />
              </span>
              <p className="text-sm font-bold">{tr("لا نتائج مطابقة لبحثك", "No results match your search")}</p>
              <p className="max-w-xs text-[12px] leading-6 text-muted-foreground">
                {tr(`جرّب كلمة أخرى أو بدّل تصفية النوع — السجل يحتوي ${items.length} عنصرًا.`, `Try a different keyword or switch the type filter — your history holds ${items.length} ${items.length === 1 ? "item" : "items"}.`)}
              </p>
              <button
                type="button"
                onClick={() => { setQuery(""); setTypeFilter("all") }}
                className="btn-ghost mt-1 inline-flex h-9 items-center gap-2 rounded-xl px-4 text-[12.5px] font-bold"
              >
                <RotateCcwIcon />
                {tr("إعادة ضبط التصفية", "Reset filters")}
              </button>
            </div>
          )}
        </motion.div>
      </div>

      {/* Preview modal */}
      <PreviewModal item={preview} onClose={() => setPreview(null)} />
    </section>
  )
}

function RotateCcwIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  )
}
