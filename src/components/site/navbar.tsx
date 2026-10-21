"use client"

import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { Zap, Languages } from "lucide-react"
import { LogoMark, Wordmark } from "./logo"
import { useLang } from "@/lib/i18n"
import { cn } from "@/lib/utils"

export function Navbar() {
  const { lang, setLang, tr } = useLang()
  const [scrolled, setScrolled] = useState(false)
  const [progress, setProgress] = useState(0)
  const [active, setActive] = useState<string | null>(null)

  const LINKS = [
    { href: "#converter", id: "converter", label: tr("المحوّل", "Converter") },
    { href: "#my-files", id: "my-files", label: tr("ملفاتي", "My files") },
    { href: "#how", id: "how", label: tr("كيف يعمل", "How it works") },
    { href: "#features", id: "features", label: tr("المميزات", "Features") },
    { href: "#faq", id: "faq", label: tr("الأسئلة", "FAQ") },
  ]

  useEffect(() => {
    let raf = 0
    const update = () => {
      const y = window.scrollY
      setScrolled(y > 24)
      const max = document.documentElement.scrollHeight - window.innerHeight
      setProgress(max > 0 ? Math.min(1, y / max) : 0)
    }
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(update)
    }
    update()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("scroll", onScroll)
    }
  }, [])

  useEffect(() => {
    const ids = LINKS.map((l) => l.id)
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id)
        }
      },
      { rootMargin: "-30% 0px -60% 0px" }
    )
    for (const id of ids) {
      const el = document.getElementById(id)
      if (el) observer.observe(el)
    }
    return () => observer.disconnect()
  }, [lang])

  return (
    <motion.header
      initial={{ y: -32, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      className="fixed inset-x-0 top-0 z-50"
    >
      {/* Scroll progress — a thread of gold following your reading */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[2.5px] bg-transparent" aria-hidden="true">
        <div
          className="scroll-progress h-full w-full"
          style={{ transform: `scaleX(${progress})` }}
        />
      </div>

      <div
        className={cn(
          "mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 transition-all duration-500 sm:px-6",
          scrolled && "h-14"
        )}
      >
        {/* Brand */}
        <a href="#top" className="group flex items-center gap-3" aria-label="ELMINYAWE — Home">
          <div className="relative">
            <LogoMark className="h-10 w-10 transition-transform duration-500 group-hover:scale-105 group-hover:rotate-3" />
            <div className="absolute inset-0 -z-10 rounded-full bg-[#e9a23b]/20 blur-lg opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
          </div>
          <div className="flex flex-col">
            <Wordmark className="text-lg leading-none" />
            <span className="text-[10px] font-medium tracking-[0.2em] text-muted-foreground">
              MEDIA STUDIO
            </span>
          </div>
        </a>

        {/* Links with active gold underline */}
        <nav className="hidden items-center gap-1 md:flex" aria-label={tr("التنقل الرئيسي", "Main navigation")}>
          {LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={cn(
                "relative rounded-lg px-4 py-2 text-sm font-medium transition-colors duration-300",
                active === link.id
                  ? "text-[#f0c274]"
                  : "text-muted-foreground hover:bg-white/5 hover:text-foreground"
              )}
            >
              {link.label}
              <span
                className={cn(
                  "absolute inset-x-4 bottom-0.5 h-px origin-center bg-gradient-to-r from-transparent via-[#e9a23b] to-transparent transition-transform duration-500",
                  active === link.id ? "scale-x-100" : "scale-x-0"
                )}
                aria-hidden="true"
              />
            </a>
          ))}
        </nav>

        {/* Language toggle + status + CTA */}
        <div className="flex items-center gap-2.5">
          {/* Language switch — animated AR/EN pill */}
          <motion.button
            type="button"
            onClick={() => setLang(lang === "ar" ? "en" : "ar")}
            whileTap={{ scale: 0.94 }}
            className="lang-toggle group relative flex h-9 items-center gap-1.5 overflow-hidden rounded-full border border-[#e9a23b]/25 bg-[#e9a23b]/[0.06] px-1.5 font-mono text-[11px] font-bold"
            aria-label={tr("التبديل إلى الإنجليزية", "Switch to Arabic")}
            title={tr("التبديل إلى الإنجليزية", "Switch to Arabic")}
          >
            <Languages className="h-3.5 w-3.5 text-[#f0c274]/80 transition-transform duration-500 group-hover:rotate-12" aria-hidden="true" />
            <span
              className={cn(
                "flex items-center rounded-full px-2.5 py-1 transition-all duration-400",
                lang === "ar"
                  ? "bg-[#e9a23b] text-[#231303]"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              ع
            </span>
            <span
              className={cn(
                "flex items-center rounded-full px-2.5 py-1 transition-all duration-400",
                lang === "en"
                  ? "bg-[#e9a23b] text-[#231303]"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              EN
            </span>
          </motion.button>

          <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 lg:flex">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#2dd4a7] opacity-60" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#2dd4a7]" />
            </span>
            <span className="text-xs font-semibold text-[#c4beb2]">
              {tr("الخدمة تعمل", "All systems live")}
            </span>
          </div>
          <a
            href="#converter"
            className="btn-gold shine inline-flex h-9 items-center gap-2 rounded-xl px-4 text-sm font-bold"
          >
            <Zap className="h-4 w-4" strokeWidth={2.5} />
            <span>{tr("ابدأ التحويل", "Start converting")}</span>
          </a>
        </div>
      </div>

      {/* Glass bar behind on scroll */}
      <div
        className={cn(
          "pointer-events-none absolute inset-0 -z-10 border-b transition-all duration-500",
          scrolled
            ? "border-white/[0.07] bg-[#070709]/75 backdrop-blur-xl opacity-100"
            : "border-transparent opacity-0"
        )}
      />
    </motion.header>
  )
}
