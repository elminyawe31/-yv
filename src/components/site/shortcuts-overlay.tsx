"use client"

import { useEffect, useState, useCallback } from "react"
import { Keyboard, Slash, ClipboardPaste, HelpCircle, Search, X } from "lucide-react"
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { useLang } from "@/lib/i18n"

export function ShortcutsOverlay() {
  const { lang, tr } = useLang()
  const [open, setOpen] = useState(false)

  const toggle = useCallback(() => setOpen((v) => !v), [])

  const SHORTCUTS = [
    {
      keys: "/",
      label: tr("الانتقال السريع لحقل الرابط", "Jump to the link field"),
      hint: tr(
        "من أي مكان في الصفحة (أو «ذ» بلوحة المفاتيح العربية)",
        "From anywhere on the page"
      ),
      icon: Slash,
    },
    {
      keys: "Ctrl + V",
      label: tr("التقاط رابط يوتيوب من الحافظة", "Capture a YouTube link from the clipboard"),
      hint: tr(
        "الصق في أي مكان بالصفحة — يُلتقط الرابط تلقائيًا",
        "Paste anywhere on the page — the link is captured automatically"
      ),
      icon: ClipboardPaste,
    },
    {
      keys: "Enter",
      label: tr("التعرف على الفيديو", "Recognize the video"),
      hint: tr("من داخل حقل الرابط مباشرة", "Directly inside the link field"),
      icon: Search,
    },
    {
      keys: "?",
      label: tr("عرض قائمة الاختصارات", "Show the shortcuts list"),
      hint: tr("هذه النافذة", "This dialog"),
      icon: HelpCircle,
    },
    {
      keys: "Esc",
      label: tr("إغلاق النوافذ الحوارية", "Close dialogs"),
      hint: tr("إغلاق أي نافذة مفتوحة", "Closes any open dialog"),
      icon: X,
    },
  ] as const

  /* "?" opens the overlay (Shift + / on most layouts) */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" && e.key !== "؟") return
      const target = e.target as HTMLElement | null
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return
      e.preventDefault()
      setOpen((v) => !v)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  return (
    <>
      {/* Floating hint chip (anchored FAB, bottom-left corner) */}
      <button
        type="button"
        onClick={toggle}
        className="shortcuts-fab glass glass-hover fixed bottom-5 left-5 z-40 inline-flex h-10 items-center gap-2.5 rounded-full border-white/12 px-4 text-[12px] font-bold text-foreground/75 transition-transform duration-300 hover:-translate-y-0.5"
        aria-label={tr("اختصارات لوحة المفاتيح", "Keyboard shortcuts")}
      >
        <Keyboard className="h-4 w-4 text-[#f0c274]" />
        <span className="hidden sm:inline">{tr("اختصارات", "Shortcuts")}</span>
        <span className="kbd-gold" aria-hidden="true">?</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="glass-deep max-w-md gap-0 rounded-3xl border-white/10 p-0"
          dir={lang === "ar" ? "rtl" : "ltr"}
        >
          <div className="gold-ring relative overflow-hidden rounded-3xl">
            <DialogHeader className="space-y-2 p-6 pb-4">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#e9a23b]/12 text-[#f0c274]">
                  <Keyboard className="h-4.5 w-4.5" />
                </span>
                <div>
                  <DialogTitle className="font-display text-base font-bold">
                    {tr("اختصارات لوحة المفاتيح", "Keyboard shortcuts")}
                  </DialogTitle>
                  <DialogDescription className="text-[11.5px]">
                    {tr("تحكّم أسرع بالمنصة دون لمس الفأرة", "Faster control without touching the mouse")}
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="divider-gold mx-6" />

            <div className="flex flex-col gap-1 p-4">
              {SHORTCUTS.map((s) => (
                <div
                  key={s.label}
                  className="flex items-center gap-3 rounded-xl px-2.5 py-2.5 transition-colors hover:bg-white/[0.04]"
                >
                  <s.icon className="h-4 w-4 shrink-0 text-[#e9a23b]/80" strokeWidth={1.8} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold">{s.label}</p>
                    <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{s.hint}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1" dir="ltr">
                    {s.keys.split(" + ").map((k) => (
                      <span key={k} className="kbd-gold">{k}</span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
