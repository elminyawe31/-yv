"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Music4, Film, Trash2, Loader2, Download, FolderOpen,
  Gauge, ShieldCheck, ShieldAlert, Hash, RefreshCw, Cloud,
  CloudOff, FileArchive, Infinity as InfinityIcon, Copy, Check,
} from "lucide-react"
import { toast } from "sonner"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { cn } from "@/lib/utils"
import { useLang, absoluteLink, type Lang } from "@/lib/i18n"
import { SectionHead } from "./section-head"

/* ============================================================================
 *  My Files & Storage — the per-user files dashboard.
 *
 *  Data comes from /api/storage: the owner's OWN files plus plain usage
 *  numbers computed live from those exact rows. By the owner's design
 *  there is NO quota — storage is unlimited and so is the number of
 *  conversions; the only cap is 80MB per single file (Catbox upload
 *  ceiling), enforced at conversion time.
 * ============================================================================
 */

interface StorageFile {
  id: string
  title: string
  ext: "mp3" | "mp4"
  storage: string
  quality: string
  engine?: string
  sizeBytes: number
  sizeMB: number
  videoId?: string | null
  thumbnail?: string | null
  path: string
  createdAt: string
}

interface StorageData {
  ok: boolean
  owner: string
  mode: "catbox" | "sqlite" | "memory"
  modeLabel: { ar: string; en: string }
  persistent: boolean
  usage: {
    count: number
    bytes: number
    mb: number
  }
  files: StorageFile[]
}

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

function formatBytes(bytes: number, lang: Lang): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(2)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return lang === "en" ? `${bytes} bytes` : `${bytes} بايت`
}

export function MyFiles({ refreshKey = 0 }: { refreshKey?: number }) {
  const { lang, tr, isRTL } = useLang()
  const [data, setData] = useState<StorageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  /* which file's link was just copied (for the check-mark feedback) */
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const copyFileLink = useCallback(async (file: { id: string; title: string; path: string }) => {
    const url = absoluteLink(file.path)
    if (!url) {
      toast.error(tr("تعذّر بناء الرابط", "Couldn't build the link"))
      return
    }
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(file.id)
      toast.success(tr("تم نسخ الرابط المباشر — احتفظ به لرجوعك إليه وقتما تشاء", "Direct link copied — keep it to get back to your file anytime"))
      setTimeout(() => setCopiedId((cur) => (cur === file.id ? null : cur)), 2000)
    } catch {
      toast.error(tr("تعذّر النسخ — انسخ الرابط يدويًا", "Copy failed — copy the link manually"))
    }
  }, [tr])

  const [confirmAll, setConfirmAll] = useState(false)
  const [busyAll, setBusyAll] = useState(false)

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true)
    try {
      const res = await fetch("/api/storage", { cache: "no-store" })
      const json = (await res.json()) as StorageData
      if (json.ok) setData(json)
    } catch {
      /* keep last good data */
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const deleteFile = useCallback(async (id: string) => {
    setDeletingId(id)
    try {
      const res = await fetch(`/api/storage?id=${encodeURIComponent(id)}`, { method: "DELETE" })
      const json = await res.json()
      if (json.ok) {
        toast.success(tr("تم حذف الملف بنجاح", "File deleted successfully"))
        await load(true)
        window.dispatchEvent(new CustomEvent("elminyawe:history-cleared"))
      } else {
        toast.error(json.error || tr("تعذّر حذف الملف", "Could not delete the file"))
      }
    } catch {
      toast.error(tr("تعذّر حذف الملف", "Could not delete the file"))
    } finally {
      setDeletingId(null)
    }
  }, [load, tr])

  const deleteAll = useCallback(async () => {
    setBusyAll(true)
    try {
      const res = await fetch("/api/storage?all=1", { method: "DELETE" })
      const json = await res.json()
      if (json.ok) {
        toast.success(tr(`تم حذف ${json.deleted} ملفًا بنجاح`, `Deleted ${json.deleted} file(s) successfully`))
        await load(true)
        window.dispatchEvent(new CustomEvent("elminyawe:history-cleared"))
      } else {
        toast.error(json.error || tr("تعذّر مسح الملفات", "Could not clear the files"))
      }
    } catch {
      toast.error(tr("تعذّر مسح الملفات", "Could not clear the files"))
    } finally {
      setBusyAll(false)
    }
  }, [load, tr])

  const files = data?.files ?? []

  const cards = useMemo(() => {
    const usage = data?.usage
    return [
      {
        key: "count",
        icon: FolderOpen,
        value: String(usage?.count ?? 0),
        unit: tr("ملف", usage?.count === 1 ? "file" : "files"),
        label: tr("ملفاتك المخزّنة", "Your stored files"),
        live: true,
      },
      {
        key: "used",
        icon: Gauge,
        value: usage ? `${usage.mb.toFixed(2)}` : "0.00",
        unit: "MB",
        label: tr("إجمالي ما حوّلته", "Total converted"),
        live: true,
      },
      {
        key: "mode",
        icon: data?.persistent ? Cloud : CloudOff,
        value: "",
        unit: "",
        label: tr("وضع التخزين", "Storage mode"),
        live: false,
        modeText: data ? (lang === "ar" ? data.modeLabel.ar : data.modeLabel.en) : "…",
        persistent: data?.persistent ?? false,
      },
    ]
  }, [data, lang, tr])

  return (
    <section id="my-files" className="relative mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-14" aria-label={tr("ملفاتي والتخزين", "My files & storage")}>
      <SectionHead
        eyebrow={tr("مساحتك الخاصة", "Your private space")}
        title={tr("ملفاتي", "My files")}
        highlight={tr("والتخزين", "& storage")}
        description={tr(
          "كل ملفاتك المحوّلة في مكان واحد — حمّل ملفاتك واحذف ما تشاء وقتما تشاء. التخزين غير محدود بلا حصة وبلا حد لعدد المرات؛ الحد الوحيد هو 80MB لحجم الملف الواحد.",
          "All your converted files in one place — download them and delete any of them whenever you like. Storage is unlimited with no quota and no conversion-count limit; the only cap is 80MB per single file."
        )}
      />

      {/* Owner identity number — "your files by your number" */}
      {data && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mx-auto mt-6 flex max-w-2xl flex-wrap items-center justify-center gap-2.5"
        >
          <span className="inline-flex items-center gap-2 rounded-full border border-[#e9a23b]/25 bg-[#e9a23b]/[0.06] px-4 py-1.5 text-xs font-semibold text-[#f0c274]">
            <Hash className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden="true" />
            {tr("رقم ملفاتك", "Your file number")}
            <span className="font-mono text-[13px] font-bold tracking-widest" dir="ltr">{data.owner}</span>
          </span>
          <button
            type="button"
            onClick={() => void load(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-[#e9a23b]/30 hover:text-foreground"
            aria-label={tr("تحديث البيانات", "Refresh data")}
          >
            <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} aria-hidden="true" />
            {tr("تحديث", "Refresh")}
          </button>
        </motion.div>
      )}

      {/* ---- Storage stat cards ---- */}
      <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        {cards.map((card, i) => (
          <motion.div
            key={card.key}
            initial={{ opacity: 0, y: 18 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-40px" }}
            transition={{ duration: 0.5, delay: i * 0.07 }}
            className="glass relative overflow-hidden rounded-2xl p-4 sm:p-5"
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(233,162,59,0.35), transparent)" }} />
            <div className="flex items-center justify-between">
              <card.icon className="h-5 w-5 text-[#f0c274]" strokeWidth={1.9} aria-hidden="true" />
              {card.live && (
                <span className="relative flex h-2 w-2" aria-hidden="true">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#2dd4a7] opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-[#2dd4a7]" />
                </span>
              )}
            </div>
            <div className="mt-3 flex items-baseline gap-1.5" dir="ltr">
              {card.key === "mode" ? (
                <span className={cn("font-display text-[15px] font-bold leading-tight", card.persistent ? "text-[#2dd4a7]" : "text-[#e9a23b]")}>
                  {card.modeText}
                </span>
              ) : (
                <>
                  <span className="font-mono text-2xl font-bold text-foreground sm:text-[26px]">{card.value}</span>
                  <span className="text-[11px] font-semibold text-muted-foreground">{card.unit}</span>
                </>
              )}
            </div>
            <p className="mt-1 text-[11px] font-medium text-muted-foreground">{card.label}</p>
          </motion.div>
        ))}
      </div>

      {/* ---- Unlimited-storage strip + volatile-mode warning ---- */}
      {data && (
        <motion.div
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.15 }}
          className="glass mt-4 rounded-2xl p-4 sm:p-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-full border border-[#2dd4a7]/30 bg-[#2dd4a7]/[0.07]">
                <InfinityIcon className="h-4 w-4 text-[#2dd4a7]" strokeWidth={2.2} aria-hidden="true" />
              </span>
              <div>
                <p className="text-[13px] font-bold text-[#8ae6c8]">
                  {tr("تخزين غير محدود — بلا حصة وبلا عدّاد", "Unlimited storage — no quota, no counters")}
                </p>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                  {tr(
                    "الحد الوحيد هو حجم الملف الواحد (80MB) ضمن سقف الرفع للتخزين الخارجي.",
                    "The only limit is the single-file size (80MB), within the external-storage upload cap."
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 font-mono text-[12px] font-bold" dir="ltr">
              <ShieldCheck className="h-4 w-4 text-[#2dd4a7]" aria-hidden="true" />
              <span className="text-[#8ae6c8]">{data.usage.count}</span>
              <span className="text-muted-foreground">{tr("ملف بالسجل الدائم", "files on the durable record")}</span>
            </div>
          </div>

          {/* Volatile-mode warning (Vercel without a catbox userhash) */}
          {!data.persistent && (
            <div className="mt-3 flex items-start gap-2.5 rounded-xl border border-[#e9a23b]/25 bg-[#e9a23b]/[0.07] px-3.5 py-2.5">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[#f0c274]" aria-hidden="true" />
              <p className="text-[11.5px] leading-5 text-[#f0c274]">
                {tr(
                  "الوضع الحالي ذاكرة مؤقتة: السجلات تُفقد عند إعادة تشغيل الخادم. اضبط متغيّر CATBOX_USERHASH ليصبح التخزين دائمًا على Catbox عبر عمليات النشر.",
                  "Current mode is volatile memory: records are lost on server restarts. Set CATBOX_USERHASH for durable Catbox storage across deploys."
                )}
              </p>
            </div>
          )}
        </motion.div>
      )}

      {/* ---- Files list ---- */}
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.55, delay: 0.2 }}
        className="glass mt-4 overflow-hidden rounded-2xl"
      >
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.07] px-4 py-3.5 sm:px-5">
          <div className="flex items-center gap-2">
            <FileArchive className="h-4 w-4 text-[#f0c274]" strokeWidth={1.9} aria-hidden="true" />
            <h3 className="font-display text-[14px] font-bold">{tr("ملفاتك المخزّنة", "Your stored files")}</h3>
            <span className="rounded-md border border-[#e9a23b]/25 bg-[#e9a23b]/8 px-2 py-0.5 font-mono text-[10.5px] font-bold text-[#f0c274]" dir="ltr">
              {files.length}
            </span>
          </div>
          {files.length > 0 && (
            <button
              type="button"
              onClick={() => setConfirmAll(true)}
              disabled={busyAll || deletingId !== null}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#e5484d]/30 bg-[#e5484d]/[0.08] px-3 text-[11.5px] font-bold text-[#ff8589] transition-colors hover:bg-[#e5484d]/15 disabled:opacity-50"
              aria-label={tr("حذف جميع الملفات", "Delete all files")}
            >
              {busyAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />}
              {tr("حذف الكل", "Delete all")}
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-14 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            <span className="text-sm">{tr("جارٍ قراءة ملفاتك…", "Reading your files…")}</span>
          </div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-[#e9a23b]/15 blur-xl" aria-hidden="true" />
              <div className="relative flex h-14 w-14 items-center justify-center rounded-full border border-[#e9a23b]/25 bg-[#e9a23b]/[0.07]">
                <FolderOpen className="h-7 w-7 text-[#f0c274]" strokeWidth={1.6} aria-hidden="true" />
              </div>
            </div>
            <p className="text-sm font-bold">{tr("لا توجد ملفات بعد", "No files yet")}</p>
            <p className="max-w-sm text-[12.5px] leading-6 text-muted-foreground">
              {tr(
                "حوّل أول فيديو أو مقطع صوتي وسيظهر هنا تلقائيًا — التخزين غير محدود.",
                "Convert your first video or audio and it will appear here automatically — storage is unlimited."
              )}
            </p>
          </div>
        ) : (
          <ul className="nice-scroll max-h-96 divide-y divide-white/[0.05] overflow-y-auto pb-20" role="list">
            <AnimatePresence initial={false}>
              {files.map((f) => {
                const isAudio = f.ext === "mp3"
                const deleting = deletingId === f.id
                return (
                  <motion.li
                    key={f.id}
                    layout
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: isRTL ? 40 : -40, transition: { duration: 0.25 } }}
                    transition={{ duration: 0.3 }}
                    className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.025] sm:px-5"
                  >
                    {/* Thumbnail */}
                    <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-white/[0.04]">
                      {f.thumbnail ? (
                        <img src={f.thumbnail} alt="" className="h-full w-full object-cover opacity-80" loading="lazy" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          {isAudio ? <Music4 className="h-5 w-5 text-[#f0c274]" aria-hidden="true" /> : <Film className="h-5 w-5 text-[#f0c274]" aria-hidden="true" />}
                        </div>
                      )}
                      <span className={cn(
                        "absolute bottom-0 inset-x-0 flex items-center justify-center bg-black/70 py-[2px] text-[8.5px] font-black tracking-wider text-white/90 backdrop-blur-sm",
                      )} dir="ltr">
                        {f.ext.toUpperCase()}
                      </span>
                    </div>

                    {/* Meta */}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-bold leading-5" title={f.title}>{f.title}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10.5px] text-muted-foreground" dir={isRTL ? "rtl" : "ltr"}>
                        <span className="font-mono font-bold text-[#f0c274]" dir="ltr">{f.sizeMB.toFixed(2)} MB</span>
                        <span aria-hidden="true">•</span>
                        <span dir="ltr">{f.quality}</span>
                        {f.storage === "blob" && (
                          <>
                            <span aria-hidden="true">•</span>
                            <span className="inline-flex items-center gap-1 text-[#2dd4a7]">
                              <Cloud className="h-3 w-3" aria-hidden="true" />
                              {tr("سحابي", "cloud")}
                            </span>
                          </>
                        )}
                        {f.storage === "catbox" && (
                          <>
                            <span aria-hidden="true">•</span>
                            <span className="inline-flex items-center gap-1">
                              <Cloud className="h-3 w-3" aria-hidden="true" />
                              {tr("مرآة سحابية", "mirrored")}
                            </span>
                          </>
                        )}
                        <span aria-hidden="true">•</span>
                        <span>{timeAgo(f.createdAt, lang)}</span>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex shrink-0 items-center gap-1.5">
                      {/* Copy the permanent direct link — the user's way back
                          to this file long after the conversion finished. */}
                      <button
                        type="button"
                        onClick={() => copyFileLink(f)}
                        className={cn(
                          "inline-flex h-9 w-9 items-center justify-center rounded-lg border transition-all",
                          copiedId === f.id
                            ? "border-[#2dd4a7]/40 bg-[#2dd4a7]/12 text-[#2dd4a7]"
                            : "border-white/10 bg-white/[0.03] text-muted-foreground hover:border-[#2dd4a7]/35 hover:bg-[#2dd4a7]/10 hover:text-[#8ae6c8]"
                        )}
                        aria-label={tr(`نسخ رابط ${f.title}`, `Copy the link for ${f.title}`)}
                        title={tr("نسخ الرابط المباشر", "Copy the direct link")}
                      >
                        {copiedId === f.id ? (
                          <Check className="h-4 w-4" strokeWidth={2.4} aria-hidden="true" />
                        ) : (
                          <Copy className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                        )}
                      </button>
                      <a
                        href={`${f.path}?download=1`}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-muted-foreground transition-all hover:border-[#e9a23b]/35 hover:bg-[#e9a23b]/10 hover:text-[#f0c274]"
                        aria-label={tr(`تحميل ${f.title}`, `Download ${f.title}`)}
                        title={tr("تحميل", "Download")}
                      >
                        <Download className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                      </a>
                      <button
                        type="button"
                        onClick={() => setConfirmId(f.id)}
                        disabled={deleting}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.03] text-muted-foreground transition-all hover:border-[#e5484d]/35 hover:bg-[#e5484d]/10 hover:text-[#ff8589] disabled:opacity-50"
                        aria-label={tr(`حذف ${f.title}`, `Delete ${f.title}`)}
                        title={tr("حذف الملف", "Delete file")}
                      >
                        {deleting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Trash2 className="h-4 w-4" strokeWidth={2} aria-hidden="true" />}
                      </button>
                    </div>
                  </motion.li>
                )
              })}
            </AnimatePresence>
          </ul>
        )}

        {files.length > 0 && (
          <div className="flex items-center justify-between gap-3 border-t border-white/[0.07] px-4 py-2.5 text-[10.5px] text-muted-foreground sm:px-5">
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-[#2dd4a7]" aria-hidden="true" />
              {tr("تخزين غير محدود — احذف ما تشاء وقتما تشاء", "Unlimited storage — delete anything, anytime")}
            </span>
            <span className="font-mono" dir="ltr">
              {tr("الإجمالي", "Total")} {formatBytes(data?.usage.bytes ?? 0, lang)}
            </span>
          </div>
        )}
      </motion.div>

      {/* ---- Delete-one confirmation ---- */}
      <AlertDialog open={confirmId !== null} onOpenChange={(open) => !open && setConfirmId(null)}>
        <AlertDialogContent dir={isRTL ? "rtl" : "ltr"}>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr("حذف هذا الملف؟", "Delete this file?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {tr(
                "سيُحذف الملف من قائمتك ومن التخزين الخارجي نهائيًا. لا يمكن التراجع عن الحذف.",
                "The file will be removed from your list and from the external storage permanently. This cannot be undone."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr("إلغاء", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[#e5484d] text-white hover:bg-[#e5484d]/85"
              onClick={() => {
                const id = confirmId
                setConfirmId(null)
                if (id) void deleteFile(id)
              }}
            >
              {tr("حذف الملف", "Delete file")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ---- Delete-all confirmation ---- */}
      <AlertDialog open={confirmAll} onOpenChange={setConfirmAll}>
        <AlertDialogContent dir={isRTL ? "rtl" : "ltr"}>
          <AlertDialogHeader>
            <AlertDialogTitle>{tr("حذف جميع ملفاتك؟", "Delete ALL your files?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {tr(
                `سيتم حذف ${files.length} ملفًا بإجمالي ${(data?.usage.mb ?? 0).toFixed(2)} MB نهائيًا. لا يمكن التراجع.`,
                `All ${files.length} file(s) totalling ${(data?.usage.mb ?? 0).toFixed(2)} MB will be deleted permanently. This cannot be undone.`
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tr("إلغاء", "Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-[#e5484d] text-white hover:bg-[#e5484d]/85"
              onClick={() => {
                setConfirmAll(false)
                void deleteAll()
              }}
            >
              {tr("حذف الكل", "Delete all")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
