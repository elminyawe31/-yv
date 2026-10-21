"use client"

import { useCallback, useEffect, useState } from "react"
import { motion } from "framer-motion"
import {
  ShieldCheck, KeyRound, Eye, EyeOff, Loader2, FlaskConical, Save,
  RotateCcw, LogOut, Trash2, AlertTriangle, CheckCircle2, XCircle,
  Lock, ServerCog, History as HistoryIcon, Database, Timer,
} from "lucide-react"
import { toast } from "sonner"
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { useLang } from "@/lib/i18n"
import { useAdminStore, authFetch, saveAdminToken, clearAdminToken } from "@/lib/admin-store"
import { LogoMark } from "./logo"

/* ============================================================
 *  ELMINYAWE hidden admin panel.
 *  Opened by clicking the ELMINYAWE MEDIA STUDIO mark in the
 *  footer. Lets the owner swap the Turnstile solver service at
 *  runtime and clear the conversion log.
 * ============================================================ */

interface SolverSnapshot {
  ok: boolean
  active: { url: string; source: "override" | "env" | "default" }
  override: string | null
  envSet: boolean
  default: string
  vercel: boolean
  /** Active durable-store mode (v3.4). */
  store?: "catbox" | "sqlite" | "memory"
  durable?: boolean
}

interface TestResult {
  ok: boolean
  testedUrl?: string
  ms?: number
  detail?: string
  error?: string
  /** v5.3 — documented step-by-step test report (reach → endpoint → solve → token). */
  steps?: { name: string; ok: boolean; ms: number; status?: string; detail?: string; hint?: { ar: string; en: string } }[]
  version?: string
  endpoint?: string
  tokenLength?: number
  tokenPreview?: string
}

interface StorageTestResult {
  ok: boolean
  target?: "catbox"
  userhashPresent?: boolean
  totalMs?: number
  media?: {
    ok: boolean
    steps: { name: string; ok: boolean; ms: number; detail?: string; hint?: { ar: string; en: string } }[]
  }
  records?: {
    ok: boolean
    mode?: "catbox" | "sqlite" | "memory"
    storeDomain?: string
    totalRecords?: number | null
    steps: { name: string; ok: boolean; ms: number; detail?: string; hint?: { ar: string; en: string } }[]
  }
  store?: { mode: string; persistent: boolean; label: { ar: string; en: string } }
  error?: string
}

/* Arabic/English labels for the documented solver-test steps. */
const SOLVER_STEP_LABELS: Record<string, { ar: string; en: string }> = {
  reach: { ar: "الوصول للخدمة", en: "Reach" },
  endpoint: { ar: "نقطة الحل", en: "Endpoint" },
  solve: { ar: "حل التحدي", en: "Solve" },
  token: { ar: "صلاحية التوكن", en: "Token" },
}

const SOURCE_META = {
  override: { ar: "استبدال نشط (وقت التشغيل)", en: "Active runtime override", tone: "text-[#e9a23b] border-[#e9a23b]/30 bg-[#e9a23b]/10" },
  env: { ar: "متغيّر بيئة", en: "Environment variable", tone: "text-[#a5daff] border-[#5eb5f7]/30 bg-[#5eb5f7]/10" },
  default: { ar: "الافتراضي المضمّن", en: "Built-in default", tone: "text-[#8ae6c8] border-[#2dd4a7]/30 bg-[#2dd4a7]/10" },
} as const

const STORE_META = {
  catbox: {
    ar: "تخزين Catbox الدائم — الملفات والسجلات معًا، بلا توكنات ولا إعداد",
    en: "Durable Catbox storage — files and records together, zero tokens, zero setup",
    icon: Database,
    tone: "border-[#2dd4a7]/25 bg-[#2dd4a7]/[0.07] text-[#8ae6c8]",
    dot: "bg-[#2dd4a7]",
  },
  sqlite: {
    ar: "قاعدة بيانات محلية دائمة",
    en: "Persistent local database",
    icon: Database,
    tone: "border-[#5eb5f7]/25 bg-[#5eb5f7]/[0.07] text-[#a5daff]",
    dot: "bg-[#5eb5f7]",
  },
  memory: {
    ar: "ذاكرة مؤقتة — الحفظ يزول مع إعادة تشغيل النسخة",
    en: "Ephemeral memory — saves vanish when the instance restarts",
    icon: AlertTriangle,
    tone: "border-[#e9a23b]/25 bg-[#e9a23b]/[0.07] text-[#ffd98e]",
    dot: "bg-[#e9a23b]",
  },
} as const

export function AdminPanel() {
  const { lang, tr } = useLang()
  const { open, setOpen, authed, setAuthed, refresh } = useAdminStore()

  /* login form */
  const [password, setPassword] = useState("")
  const [showPw, setShowPw] = useState(false)
  const [loggingIn, setLoggingIn] = useState(false)
  const [loginError, setLoginError] = useState("")

  /* solver state */
  const [snapshot, setSnapshot] = useState<SolverSnapshot | null>(null)
  const [newUrl, setNewUrl] = useState("")
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [testResult, setTestResult] = useState<TestResult | null>(null)

  /* history state */
  const [totalConversions, setTotalConversions] = useState<number | null>(null)
  const [clearing, setClearing] = useState(false)

  /* live elapsed seconds while a solver test runs (can take up to ~120s) */
  const [testElapsed, setTestElapsed] = useState<number | null>(null)

  /* storage live-test state */
  const [storageTesting, setStorageTesting] = useState(false)
  const [storageResult, setStorageResult] = useState<StorageTestResult | null>(null)
  useEffect(() => {
    if (!testing) return
    const startedAt = Date.now()
    setTestElapsed(0)
    const t = setInterval(() => setTestElapsed((Date.now() - startedAt) / 1000), 200)
    return () => {
      clearInterval(t)
      setTestElapsed(null)
    }
  }, [testing])

  const loadSolver = useCallback(async () => {
    try {
      const res = await authFetch("/api/admin/solver")
      if (res.status === 401) {
        setAuthed(false)
        clearAdminToken()
        return
      }
      const data = (await res.json()) as SolverSnapshot
      setSnapshot(data)
      setNewUrl(data.active?.url || "")
    } catch {
      /* ignore */
    }
  }, [setAuthed])

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch("/api/stats", { cache: "no-store" })
      const data = (await res.json()) as { totalConversions?: number }
      setTotalConversions(typeof data.totalConversions === "number" ? data.totalConversions : null)
    } catch {
      /* ignore */
    }
  }, [])

  /* boot: check the session whenever the dialog opens */
  useEffect(() => {
    if (!open) return
    setLoginError("")
    setTestResult(null)
    refresh().then(() => {
      /* refresh() sets authed; the effect below reacts to it */
    })
  }, [open, refresh])

  useEffect(() => {
    if (open && authed) {
      loadSolver()
      loadStats()
    }
  }, [open, authed, loadSolver, loadStats])

  const login = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!password || loggingIn) return
    setLoggingIn(true)
    setLoginError("")
    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
        credentials: "include",
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        error?: string
        token?: string
      }
      if (!res.ok || !data.ok) {
        setLoginError(data.error || tr("كلمة المرور غير صحيحة.", "Incorrect password."))
        return
      }
      // Keep the signed token for the header channel — this is what
      // makes the session survive cookie-blocking contexts (iframes).
      if (data.token) saveAdminToken(data.token)
      setAuthed(true)
      setPassword("")
      toast.success(tr("تم تسجيل الدخول كمشرف", "Signed in as admin"))
    } catch {
      setLoginError(tr("تعذّر الاتصال بالخادم.", "Could not reach the server."))
    } finally {
      setLoggingIn(false)
    }
  }

  const logout = async () => {
    try {
      await authFetch("/api/admin/auth", { method: "DELETE" })
    } catch {
      /* ignore */
    }
    clearAdminToken()
    setAuthed(false)
    setSnapshot(null)
    setTestResult(null)
    toast.info(tr("تم تسجيل الخروج", "Signed out"))
  }

  const runStorageTest = async () => {
    if (storageTesting) return
    setStorageTesting(true)
    setStorageResult(null)
    try {
      const res = await authFetch("/api/admin/storage/test", { method: "POST" })
      if (res.status === 401) {
        setAuthed(false)
        clearAdminToken()
        return
      }
      const data = (await res.json().catch(() => ({}))) as StorageTestResult
      setStorageResult(data)
      if (data.ok) {
        toast.success(
          tr(
            `Catbox يعمل بالكامل — ملفات وسجلات (${((data.totalMs || 0) / 1000).toFixed(1)} ث)`,
            `Catbox works end-to-end — media and records (${((data.totalMs || 0) / 1000).toFixed(1)}s)`
          )
        )
      } else if (data.records?.ok) {
        toast.error(tr("سجلات Catbox سليمة لكن دورة الملفات فشلت — راجع الخطوات", "Catbox records are healthy but the media roundtrip failed — check the steps"))
      } else if (data.media?.ok) {
        toast.error(tr("دورة الملفات سليمة لكن سجلات Catbox فشلت — راجع الخطوات", "The media roundtrip is healthy but Catbox records failed — check the steps"))
      } else {
        toast.error(tr("فشل اختبار التخزين الدائم", "Durable storage test failed"))
      }
    } catch {
      setStorageResult({ ok: false, error: tr("تعذّر الاتصال", "Connection failed") })
    } finally {
      setStorageTesting(false)
    }
  }

  const runTest = async () => {
    if (testing) return
    const candidate = newUrl.trim()
    if (!candidate) {
      toast.error(tr("أدخل رابط الحل أولًا", "Enter the solver URL first"))
      return
    }
    setTesting(true)
    setTestResult(null)
    try {
      const res = await authFetch("/api/admin/solver/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: candidate }),
      })
      const data = (await res.json().catch(() => ({}))) as TestResult
      if (res.status === 401) {
        setAuthed(false)
        clearAdminToken()
        return
      }
      setTestResult(data)
      if (data.ok) {
        toast.success(
          tr(`الحل يعمل (${((data.ms || 0) / 1000).toFixed(1)} ثانية)`, `Solver works (${((data.ms || 0) / 1000).toFixed(1)}s)`)
        )
      } else {
        toast.error(tr("فشل اختبار الحل", "Solver test failed"))
      }
    } catch {
      setTestResult({ ok: false, error: tr("تعذّر الاتصال", "Connection failed") })
    } finally {
      setTesting(false)
    }
  }

  const saveUrl = async () => {
    if (saving) return
    const url = newUrl.trim()
    if (!url || !/^https?:\/\/[^\s]+$/i.test(url)) {
      toast.error(tr("أدخل رابطًا صالحًا يبدأ بـ http:// أو https://", "Enter a valid URL starting with http:// or https://"))
      return
    }
    setSaving(true)
    try {
      const res = await authFetch("/api/admin/solver", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      })
      const data = (await res.json().catch(() => ({}))) as SolverSnapshot & { error?: string }
      if (res.status === 401) {
        setAuthed(false)
        clearAdminToken()
        return
      }
      if (!data.ok) {
        toast.error(data.error || tr("تعذّر الحفظ", "Save failed"))
        return
      }
      setSnapshot(data)
      setTestResult(null)
      const store = data.store || "sqlite"
      toast.success(
        store === "catbox"
          ? tr("تم الحفظ الدائم — يسري على كل النسخ فورًا", "Saved durably — applies to every instance instantly")
          : store === "memory"
            ? tr("تم الحفظ مؤقتًا (فعّل التخزين الدائم ليستمر)", "Saved temporarily (enable durable storage to keep it)")
            : tr("تم استبدال رابط الحل بنجاح", "Solver URL replaced successfully")
      )
    } catch {
      toast.error(tr("تعذّر الاتصال بالخادم", "Could not reach the server"))
    } finally {
      setSaving(false)
    }
  }

  const resetUrl = async () => {
    if (resetting) return
    setResetting(true)
    try {
      const res = await authFetch("/api/admin/solver", { method: "DELETE" })
      const data = (await res.json().catch(() => ({}))) as SolverSnapshot
      if (res.status === 401) {
        setAuthed(false)
        clearAdminToken()
        return
      }
      setSnapshot(data)
      setNewUrl(data.active?.url || "")
      setTestResult(null)
      toast.success(tr("تمت الاستعادة إلى الإعداد الافتراضي", "Restored to the default setting"))
    } catch {
      toast.error(tr("تعذّر الاتصال بالخادم", "Could not reach the server"))
    } finally {
      setResetting(false)
    }
  }

  const clearHistory = async () => {
    if (clearing) return
    setClearing(true)
    try {
      const res = await authFetch("/api/history?all=1", { method: "DELETE" })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; deleted?: number; error?: string }
      if (res.status === 401) {
        setAuthed(false)
        clearAdminToken()
        toast.error(tr("انتهت الجلسة — سجّل الدخول مجددًا", "Session expired — sign in again"))
        return
      }
      if (!data.ok) {
        toast.error(data.error || tr("تعذّر المسح", "Clear failed"))
        return
      }
      setTotalConversions(0)
      window.dispatchEvent(new CustomEvent("elminyawe:history-cleared"))
      toast.success(
        tr(
          `تم مسح سجل العمليات (${data.deleted ?? 0} عنصر)`,
          `Conversion log cleared (${data.deleted ?? 0} ${data.deleted === 1 ? "item" : "items"})`
        )
      )
    } catch {
      toast.error(tr("تعذّر الاتصال بالخادم", "Could not reach the server"))
    } finally {
      setClearing(false)
    }
  }

  const activeMeta = snapshot ? SOURCE_META[snapshot.active.source] : null
  const storeMeta = snapshot ? STORE_META[snapshot.store || "sqlite"] : null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        className="max-h-[90vh] overflow-y-auto border-white/10 bg-[#0b0b0f]/95 p-0 backdrop-blur-2xl sm:max-w-lg [&>button]:z-10"
      >
        {/* gold top beam */}
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{ background: "linear-gradient(90deg, transparent, rgba(233,162,59,0.55), transparent)" }}
        />

        {!authed ? (
          /* ------------------------- LOGIN ------------------------- */
          <div className="px-6 pb-7 pt-8">
            <DialogHeader className="items-center text-center">
              <motion.div
                initial={{ scale: 0.85, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 260, damping: 20 }}
                className="relative mb-1"
              >
                <div className="absolute inset-0 -z-10 rounded-full bg-[#e9a23b]/20 blur-xl" />
                <LogoMark className="h-14 w-14" />
              </motion.div>
              <DialogTitle className="font-display text-lg tracking-wide">
                <span className="text-gold-gradient">ELMINYAWE</span>
                <span className="mx-2 text-muted-foreground">·</span>
                {tr("منطقة محمية", "Protected Area")}
              </DialogTitle>
              <DialogDescription className="text-[12.5px]">
                {tr(
                  "هذه اللوحة مخصّصة لمشرف الموقع فقط.",
                  "This panel is reserved for the site administrator."
                )}
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={login} className="mx-auto mt-6 flex max-w-xs flex-col gap-3">
              <div className="relative">
                <Lock className="pointer-events-none absolute inset-y-0 start-3 my-auto h-4 w-4 text-muted-foreground/60" />
                <Input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    setLoginError("")
                  }}
                  placeholder={tr("كلمة مرور المشرف", "Admin password")}
                  autoComplete="current-password"
                  dir="ltr"
                  className="h-11 border-white/10 bg-white/[0.03] ps-10 pe-11 text-center tracking-[0.25em]"
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label={showPw ? tr("إخفاء كلمة المرور", "Hide password") : tr("إظهار كلمة المرور", "Show password")}
                  className="absolute inset-y-0 end-3 my-auto flex h-6 w-6 items-center justify-center text-muted-foreground/60 transition-colors hover:text-foreground"
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              {loginError && (
                <motion.p
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-[#f0554d]/25 bg-[#f0554d]/10 px-3 py-2 text-center text-[12px] text-[#ff8f88]"
                >
                  <XCircle className="h-3.5 w-3.5 shrink-0" />
                  {loginError}
                </motion.p>
              )}

              <Button
                type="submit"
                disabled={!password || loggingIn}
                className="h-11 w-full border border-[#e9a23b]/35 bg-gradient-to-b from-[#e9a23b]/25 to-[#b87a1e]/15 text-[#ffd98e] shadow-none hover:from-[#e9a23b]/35 hover:to-[#b87a1e]/25 disabled:opacity-40"
              >
                {loggingIn ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <KeyRound className="h-4 w-4" />
                )}
                {tr("دخول المشرف", "Admin sign-in")}
              </Button>
            </form>
          </div>
        ) : (
          /* ------------------------- PANEL ------------------------- */
          <div className="px-5 pb-6 pt-6 sm:px-6">
            <DialogHeader className="flex-row items-center justify-between space-y-0">
              <div className="flex items-center gap-2.5">
                <div className="relative">
                  <div className="absolute inset-0 -z-10 rounded-full bg-[#2dd4a7]/20 blur-lg" />
                  <ShieldCheck className="h-6 w-6 text-[#2dd4a7]" strokeWidth={2} />
                </div>
                <div>
                  <DialogTitle className="text-[15px] leading-tight">
                    {tr("لوحة تحكم ELMINYAWE", "ELMINYAWE Control Panel")}
                  </DialogTitle>
                  <DialogDescription className="text-[11px] text-[#8ae6c8]/80">
                    {tr("وضع المشرف نشط", "Admin mode active")}
                  </DialogDescription>
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={logout}
                className="h-8 border-white/10 bg-transparent text-muted-foreground hover:border-[#f0554d]/30 hover:bg-[#f0554d]/10 hover:text-[#ff8f88]"
              >
                <LogOut className="h-3.5 w-3.5" />
                {tr("خروج", "Sign out")}
              </Button>
            </DialogHeader>

            {/* ============ SOLVER SERVICE CARD ============ */}
            <section className="mt-5 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
              <div className="flex items-center gap-2">
                <ServerCog className="h-4 w-4 text-[#e9a23b]" />
                <h3 className="text-[13px] font-semibold">
                  {tr("خدمة تجاوز التحقق الذكي", "Verification-solver service")}
                </h3>
                {snapshot && (
                  <span
                    className={cn(
                      "ms-auto rounded-full border px-2 py-0.5 text-[10px] font-medium",
                      activeMeta?.tone
                    )}
                  >
                    {activeMeta ? (lang === "en" ? activeMeta.en : activeMeta.ar) : "…"}
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-[11.5px] leading-5 text-muted-foreground">
                {tr(
                  "إن انتهت مدة خدمة الحل أو توقفت، ضع رابط الخدمة البديلة بنفس الوظيفة ثم اختبره واحفظه.",
                  "If the solver service expired or died, paste the replacement URL (same function), test it, then save."
                )}
              </p>

              {/* active URL */}
              <div className="mt-3 rounded-xl border border-white/[0.06] bg-black/30 p-3">
                <div className="flex items-center gap-2">
                  <span className={cn(
                    "h-1.5 w-1.5 shrink-0 rounded-full",
                    snapshot?.active.url ? "bg-[#2dd4a7] shadow-[0_0_8px_rgba(45,212,167,0.8)]" : "bg-[#f0554d]"
                  )} />
                  <span className="text-[10.5px] font-medium text-muted-foreground">
                    {tr("الرابط النشط الآن", "Currently active URL")}
                  </span>
                </div>
                <p dir="ltr" className="mt-1 break-all font-mono text-[12px] text-foreground/90">
                  {snapshot?.active.url || tr("معطّل", "disabled")}
                </p>
              </div>

              {/* ============ STORAGE STATUS STRIP + LIVE TEST ============ */}
              {storeMeta && (
                <div className={cn("mt-4 flex items-center gap-2.5 rounded-xl border p-2.5", storeMeta.tone)}>
                  <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", storeMeta.dot)} />
                  <storeMeta.icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 text-[11px] font-medium leading-4">
                    {tr("التخزين:", "Storage:")}{" "}
                    {lang === "en" ? storeMeta.en : storeMeta.ar}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={runStorageTest}
                    disabled={storageTesting}
                    className="h-7 shrink-0 gap-1 rounded-lg border-[#2dd4a7]/25 bg-[#2dd4a7]/10 px-2.5 text-[10.5px] font-medium text-[#8ae6c8] hover:bg-[#2dd4a7]/20"
                  >
                    {storageTesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <FlaskConical className="h-3 w-3" />}
                    {storageTesting ? tr("جارٍ الاختبار…", "Testing…") : tr("اختبار التخزين", "Test storage")}
                  </Button>
                </div>
              )}

              {/* storage live-test result — v5.4: media + records phases */}
              {storageResult && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className={cn(
                    "mt-3 overflow-hidden rounded-xl border p-3 text-[11.5px] leading-5",
                    storageResult.ok
                      ? "border-[#2dd4a7]/25 bg-[#2dd4a7]/10 text-[#8ae6c8]"
                      : "border-[#f0554d]/25 bg-[#f0554d]/10 text-[#ff8f88]"
                  )}
                >
                  <div className="flex flex-wrap items-center gap-1.5 font-semibold">
                    {storageResult.ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <XCircle className="h-3.5 w-3.5 shrink-0" />}
                    {storageResult.ok
                      ? tr(
                          `Catbox يعمل بالكامل — رفع وقراءة وتحقق وحذف${typeof storageResult.records?.totalRecords === "number" ? ` · ${storageResult.records.totalRecords} سجل` : ""}`,
                          `Catbox works end-to-end — upload, read, verify & delete${typeof storageResult.records?.totalRecords === "number" ? ` · ${storageResult.records.totalRecords} records` : ""}`
                        )
                      : tr("فشل اختبار التخزين الدائم", "Durable storage test failed")}
                    {typeof storageResult.totalMs === "number" && (
                      <span className="font-normal opacity-75">· {(storageResult.totalMs / 1000).toFixed(1)}s</span>
                    )}
                  </div>

                  {/* phase 1 — media files roundtrip */}
                  {storageResult.media && (
                    <div className="mt-2">
                      <p className="font-semibold opacity-90">
                        {tr("۱ — دورة الملفات (رفع/قراءة/حذف MP3 حقيقي):", "1 — Media roundtrip (real MP3 upload/read/delete):")}{" "}
                        <span className={storageResult.media.ok ? "text-[#8ae6c8]" : "text-[#ff8f88]"}>
                          {storageResult.media.ok ? "✓" : "✕"}
                        </span>
                      </p>
                      <div dir="ltr" className="mt-1 flex flex-wrap gap-1.5">
                        {storageResult.media.steps.map((s) => (
                          <span
                            key={s.name}
                            title={s.hint ? (lang === "en" ? s.hint.en : s.hint.ar) : s.detail || s.name}
                            className={cn(
                              "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[9.5px]",
                              s.ok
                                ? "border-[#2dd4a7]/30 bg-[#2dd4a7]/10 text-[#8ae6c8]"
                                : "border-[#f0554d]/30 bg-[#f0554d]/10 text-[#ff8f88]"
                            )}
                          >
                            {s.ok ? "✓" : "✕"} {s.name}{s.ms ? ` ${s.ms}ms` : ""}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* phase 2 — records store roundtrip */}
                  {storageResult.records && (
                    <div className="mt-2">
                      <p className="font-semibold opacity-90">
                        {tr("۲ — دورة السجلات (ألبوم Catbox):", "2 — Records roundtrip (Catbox album):")}{" "}
                        <span className={storageResult.records.ok ? "text-[#8ae6c8]" : "text-[#ff8f88]"}>
                          {storageResult.records.ok ? "✓" : "✕"}
                        </span>
                      </p>
                      {storageResult.records.storeDomain && (
                        <p dir="ltr" className="mt-0.5 break-all font-mono text-[10px] opacity-80">
                          {tr("الألبوم: ", "Album: ")}{storageResult.records.storeDomain}
                        </p>
                      )}
                      <div dir="ltr" className="mt-1 flex flex-wrap gap-1.5">
                        {storageResult.records.steps.map((s) => (
                          <span
                            key={s.name}
                            title={s.hint ? (lang === "en" ? s.hint.en : s.hint.ar) : s.detail || s.name}
                            className={cn(
                              "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[9.5px]",
                              s.ok
                                ? "border-[#2dd4a7]/30 bg-[#2dd4a7]/10 text-[#8ae6c8]"
                                : "border-[#f0554d]/30 bg-[#f0554d]/10 text-[#ff8f88]"
                            )}
                          >
                            {s.ok ? "✓" : "✕"} {s.name}{s.ms ? ` ${s.ms}ms` : ""}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {storageResult.error && <p className="mt-1.5 opacity-90">{storageResult.error}</p>}
                  {/* actionable guidance for the first failed step */}
                  {[...(storageResult.media?.steps ?? []), ...(storageResult.records?.steps ?? [])].some((s) => !s.ok && s.hint) && (
                    <p className="mt-2 rounded-lg border border-[#f0554d]/20 bg-black/25 p-2 text-[10.5px] leading-4.5">
                      {(() => {
                        const failed = [...(storageResult.media?.steps ?? []), ...(storageResult.records?.steps ?? [])].find((s) => !s.ok && s.hint)
                        return failed?.hint ? (lang === "en" ? failed.hint.en : failed.hint.ar) : ""
                      })()}
                    </p>
                  )}
                </motion.div>
              )}

              {/* ============ CATBOX INFO (v5.4 — no setup needed) ============ */}
              {snapshot?.vercel && snapshot.store === "memory" && (
                <div className="mt-3 rounded-xl border border-[#e9a23b]/25 bg-[#e9a23b]/[0.06] p-3.5 text-[11px] leading-5 text-[#ffd98e]/90">
                  <div className="flex items-center gap-1.5 font-semibold">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {tr("فعّل التخزين الدائم على Vercel (مرة واحدة فقط)", "Enable durable storage on Vercel (one-time setup)")}
                  </div>
                  <ol className="mt-2 list-inside list-decimal space-y-1 ps-1">
                    <li>{tr("اضبط متغيّر البيئة CATBOX_USERHASH على حسابك (userhash من إدارة الحساب في catbox.moe).", "Set the CATBOX_USERHASH environment variable to your account's userhash (from catbox.moe account manager).")}</li>
                    <li>{tr("أعد النشر (Redeploy) — بعدها تُحفظ الملفات والسجلات دائمًا على Catbox بلا أي توكنات.", "Redeploy — from then on files AND records persist on Catbox with zero tokens.")}</li>
                  </ol>
                </div>
              )}

              {/* new URL input */}
              <label className="mt-3 block text-[11px] font-medium text-muted-foreground">
                {tr("رابط الخدمة — يقبل أي شكل", "Service URL — any shape accepted")}
              </label>
              <Input
                dir="ltr"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://turn-production-xxxx.up.railway.app أو https://…de.deplexo.com/solve"
                className="mt-1.5 h-10 border-white/10 bg-white/[0.03] font-mono text-[12px]"
              />
              <p className="mt-1.5 text-[10.5px] leading-4 text-muted-foreground/80">
                {tr(
                  "الصق الرابط كما هو — مع أو بدون /solve ومع أو بدون شرطة زائدة، سيكتشف النظام نقطة النهاية الصحيحة تلقائيًا.",
                  "Paste the URL as-is — with or without /solve and trailing slashes; the correct endpoint is auto-detected."
                )}
              </p>

              {/* actions */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={runTest}
                  disabled={testing}
                  className="h-9 border-[#5eb5f7]/25 bg-[#5eb5f7]/10 text-[#a5daff] hover:bg-[#5eb5f7]/20"
                >
                  {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
                  {testing && testElapsed !== null
                    ? tr(`اختبار… ${testElapsed.toFixed(1)} ث`, `Testing… ${testElapsed.toFixed(1)}s`)
                    : tr("اختبار", "Test")}
                </Button>
                <Button
                  size="sm"
                  onClick={saveUrl}
                  disabled={saving}
                  className="h-9 border border-[#e9a23b]/35 bg-gradient-to-b from-[#e9a23b]/25 to-[#b87a1e]/15 text-[#ffd98e] shadow-none hover:from-[#e9a23b]/35"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  {tr("حفظ واستبدال", "Save & replace")}
                </Button>
                {snapshot?.override && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={resetUrl}
                    disabled={resetting}
                    className="h-9 border-white/10 bg-transparent text-muted-foreground hover:text-foreground"
                  >
                    {resetting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                    {tr("استعادة الافتراضي", "Reset to default")}
                  </Button>
                )}
              </div>

              {/* test result — v5.3 documented step-by-step report */}
              {testResult && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  className={cn(
                    "mt-3 overflow-hidden rounded-xl border p-3 text-[11.5px] leading-5",
                    testResult.ok
                      ? "border-[#2dd4a7]/25 bg-[#2dd4a7]/10 text-[#8ae6c8]"
                      : "border-[#f0554d]/25 bg-[#f0554d]/10 text-[#ff8f88]"
                  )}
                >
                  <div className="flex flex-wrap items-center gap-1.5 font-semibold">
                    {testResult.ok ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0" /> : <XCircle className="h-3.5 w-3.5 shrink-0" />}
                    {testResult.ok
                      ? tr("نجح الاختبار — الخدمة تحل التحدي فعليًا", "Test passed — the service actually solves the challenge")
                      : tr("فشل الاختبار — راجع الخطوة المعلّمة بالأحمر", "Test failed — see the step marked in red")}
                    {typeof testResult.ms === "number" && (
                      <span className="font-normal opacity-75">· {((testResult.ms) / 1000).toFixed(1)}s</span>
                    )}
                    {testResult.version && (
                      <span className="rounded-md border border-[#2dd4a7]/30 bg-black/25 px-1.5 py-0.5 font-mono text-[9.5px] font-bold" dir="ltr">
                        v{testResult.version}
                      </span>
                    )}
                  </div>

                  {/* documented steps — what was checked, in order, with timings */}
                  {testResult.steps && testResult.steps.length > 0 && (
                    <div dir="ltr" className="mt-1.5 flex flex-wrap gap-1.5">
                      {testResult.steps.map((s) => {
                        const label = SOLVER_STEP_LABELS[s.name]
                        return (
                          <span
                            key={s.name}
                            title={
                              s.hint
                                ? (lang === "en" ? s.hint.en : s.hint.ar)
                                : `${s.status || ""}${s.detail ? ` — ${s.detail}` : ""}`
                            }
                            className={cn(
                              "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[9.5px]",
                              s.ok
                                ? "border-[#2dd4a7]/30 bg-[#2dd4a7]/10 text-[#8ae6c8]"
                                : "border-[#f0554d]/30 bg-[#f0554d]/10 text-[#ff8f88]"
                            )}
                          >
                            {s.ok ? "✓" : "✕"} {label ? (lang === "en" ? label.en : label.ar) : s.name}
                            {s.ms ? ` ${s.ms}ms` : ""}
                            {s.ok && s.status ? ` · ${s.status}` : ""}
                          </span>
                        )
                      })}
                    </div>
                  )}

                  {/* what answered + the token proof */}
                  {testResult.ok && (testResult.endpoint || testResult.tokenPreview) && (
                    <div dir="ltr" className="mt-1.5 space-y-0.5 font-mono text-[10px] opacity-80">
                      {testResult.endpoint && <p>endpoint: {testResult.endpoint}</p>}
                      {testResult.tokenPreview && (
                        <p className="break-all">token: {testResult.tokenPreview}{typeof testResult.tokenLength === "number" ? ` (${testResult.tokenLength} chars)` : ""}</p>
                      )}
                    </div>
                  )}

                  {testResult.detail && <p dir="ltr" className="mt-1 font-mono opacity-80">{testResult.detail}</p>}
                  {testResult.error && <p className="mt-1 opacity-90">{testResult.error}</p>}

                  {/* actionable guidance for the first failed documented step */}
                  {testResult.steps?.some((s) => !s.ok && s.hint) && (
                    <p className="mt-2 rounded-lg border border-[#f0554d]/20 bg-black/25 p-2 text-[10.5px] leading-4.5">
                      {(() => {
                        const failed = testResult.steps!.find((s) => !s.ok && s.hint)
                        return failed?.hint ? (lang === "en" ? failed.hint.en : failed.hint.ar) : ""
                      })()}
                    </p>
                  )}
                </motion.div>
              )}

              {/* live test progress hint */}
              {testing && (
                <div className="mt-3 flex items-center gap-2 rounded-xl border border-[#5eb5f7]/20 bg-[#5eb5f7]/[0.06] p-3 text-[11px] leading-5 text-[#a5daff]">
                  <Timer className="h-3.5 w-3.5 shrink-0 animate-pulse" />
                  <span>
                    {tr(
                      "اختبار موثّق من 4 خطوات: الوصول ثم نقطة الحل ثم حل تحدٍ حقيقي ثم صلاحية التوكن — قد يستغرق حتى 60 ثانية إذا كانت الخدمة نائمة وتحتاج إيقاظًا.",
                      "A documented 4-step test: reach, endpoint, a real challenge solve, then token validity — can take up to 60s if the service is asleep and needs waking."
                    )}
                    {testElapsed !== null && (
                      <span className="ms-1.5 font-mono opacity-80">({testElapsed.toFixed(1)}s)</span>
                    )}
                  </span>
                </div>
              )}

              {/* vercel durability note — only when saves are NOT already durable via Catbox */}
              {snapshot?.vercel && snapshot.store !== "catbox" && (
                <div className="mt-3 rounded-xl border border-[#e9a23b]/20 bg-[#e9a23b]/[0.07] p-3 text-[11px] leading-5 text-[#ffd98e]/90">
                  <div className="flex gap-2">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      {tr(
                        "الاستبدال يسري فورًا على هذه النسخة، ولإبقائه دائمًا عبر إعادة التشغيل أضف هذا المتغيّر من لوحة Vercel:",
                        "The swap applies instantly to this instance; to keep it permanent across restarts add this variable in the Vercel dashboard:"
                      )}
                    </span>
                  </div>
                  {snapshot.active?.url && (
                    <div className="mt-2 flex items-center gap-2 rounded-lg border border-[#e9a23b]/25 bg-black/40 px-2.5 py-1.5">
                      <code dir="ltr" className="min-w-0 flex-1 break-all font-mono text-[10.5px] text-[#ffd98e]">
                        ELMINYAWE_SOLVER_URL={snapshot.active.url}
                      </code>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard
                            .writeText(`ELMINYAWE_SOLVER_URL=${snapshot.active?.url || ""}`)
                            .then(() => toast.success(tr("تم نسخ المتغيّر", "Variable copied")))
                            .catch(() => toast.error(tr("تعذّر النسخ", "Copy failed")))
                        }}
                        className="shrink-0 rounded-md border border-[#e9a23b]/30 bg-[#e9a23b]/10 px-2 py-1 text-[10px] font-medium text-[#ffd98e] transition-colors hover:bg-[#e9a23b]/20"
                      >
                        {tr("نسخ", "Copy")}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* ============ HISTORY CARD ============ */}
            <section className="mt-4 rounded-2xl border border-white/[0.07] bg-white/[0.02] p-4">
              <div className="flex items-center gap-2">
                <HistoryIcon className="h-4 w-4 text-[#a5daff]" />
                <h3 className="text-[13px] font-semibold">
                  {tr("سجل عمليات الرفع", "Upload history")}
                </h3>
                {totalConversions !== null && (
                  <span className="ms-auto rounded-full border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[10px] text-muted-foreground">
                    {totalConversions} {tr("عملية", totalConversions === 1 ? "entry" : "entries")}
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-[11.5px] leading-5 text-muted-foreground">
                {tr(
                  "مسح السجل متاح للمشرف فقط — يحذف القيود والملفات المحلية المرآة.",
                  "Clearing the log is admin-only — removes records and local mirrored files."
                )}
              </p>

              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    size="sm"
                    disabled={clearing || totalConversions === 0}
                    className="mt-3 h-9 border border-[#f0554d]/30 bg-[#f0554d]/15 text-[#ff8f88] shadow-none hover:bg-[#f0554d]/25"
                  >
                    {clearing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    {tr("مسح كل السجل", "Clear entire log")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="border-white/10 bg-[#0b0b0f]/95 backdrop-blur-2xl">
                  <AlertDialogHeader>
                    <AlertDialogTitle className="text-[15px]">
                      {tr("مسح كل سجل العمليات؟", "Clear the entire conversion log?")}
                    </AlertDialogTitle>
                    <AlertDialogDescription className="text-[12.5px]">
                      {tr(
                        "سيُحذف كل القيود نهائيًا ولا يمكن التراجع. الروابط البعيدة المحفوظة خارج الموقع لا تتأثر.",
                        "All records will be permanently removed and cannot be undone. Remote links stored off-site are unaffected."
                      )}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel className="border-white/10 bg-transparent hover:bg-white/5">
                      {tr("تراجع", "Cancel")}
                    </AlertDialogCancel>
                    <AlertDialogAction
                      onClick={(e) => {
                        e.preventDefault()
                        clearHistory()
                      }}
                      className="border border-[#f0554d]/40 bg-[#f0554d]/25 text-[#ff8f88] hover:bg-[#f0554d]/35"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      {tr("نعم، امسح الكل", "Yes, clear all")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
