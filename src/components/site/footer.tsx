"use client"

import { Zap, ShieldCheck, Heart, MessageCircle, Send, Twitter, QrCode } from "lucide-react"
import { LogoMark, Wordmark } from "./logo"
import { InfoDialogs } from "./info-dialogs"
import { useLang, type Lang } from "@/lib/i18n"
import { useAdminStore } from "@/lib/admin-store"

/* Social share targets — the shared message text is localized so an English
   visitor shares an English invite, an Arabic visitor an Arabic one. */
function socialsFor(lang: Lang) {
  const text =
    lang === "en"
      ? "Try ELMINYAWE — the premium media converter from YouTube to MP3 & MP4"
      : "جرّب ELMINYAWE — محوّل الوسائط الفاخر من يوتيوب إلى MP3 و MP4"
  const encoded = encodeURIComponent(text)
  return [
    {
      key: "whatsapp",
      label: lang === "en" ? "Share on WhatsApp" : "شارك عبر واتساب",
      icon: MessageCircle,
      href: `https://wa.me/?text=${encoded}`,
      hover: "hover:border-[#2dd4a7]/40 hover:bg-[#2dd4a7]/10 hover:text-[#8ae6c8]",
    },
    {
      key: "telegram",
      label: lang === "en" ? "Share on Telegram" : "شارك عبر تيليجرام",
      icon: Send,
      href: `https://t.me/share/url?url=&text=${encoded}`,
      hover: "hover:border-[#5eb5f7]/40 hover:bg-[#5eb5f7]/10 hover:text-[#a5daff]",
    },
    {
      key: "x",
      label: lang === "en" ? "Share on X" : "شارك عبر X",
      icon: Twitter,
      href: `https://twitter.com/intent/tweet?text=${encoded}`,
      hover: "hover:border-white/25 hover:bg-white/8 hover:text-white",
    },
  ]
}

export function Footer() {
  const { lang, tr } = useLang()
  const socials = socialsFor(lang)
  const openAdmin = useAdminStore((s) => s.openPanel)

  return (
    <footer className="relative mt-auto border-t border-white/[0.06]">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: "linear-gradient(90deg, transparent, rgba(233,162,59,0.3), transparent)" }}
      />
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-col items-center gap-6 text-center">
          {/* Hidden admin entry — the ELMINYAWE mark opens the control panel. */}
          <button
            type="button"
            onClick={openAdmin}
            aria-label="ELMINYAWE"
            className="group cursor-pointer rounded-xl px-3 py-1.5 outline-none transition-all duration-300 focus-visible:ring-1 focus-visible:ring-[#e9a23b]/40"
          >
            <span className="pointer-events-none flex items-center gap-3 transition-transform duration-500 group-hover:scale-[1.03]">
              <LogoMark className="h-8 w-8 transition-all duration-500 group-hover:drop-shadow-[0_0_10px_rgba(233,162,59,0.45)]" />
              <span className="flex flex-col items-start">
                <Wordmark className="text-base leading-none" />
                <span className="mt-1 text-[9px] font-medium tracking-[0.25em] text-muted-foreground transition-colors duration-300 group-hover:text-[#e9a23b]/70">
                  MEDIA STUDIO
                </span>
              </span>
            </span>
          </button>

          <p className="max-w-md text-[12.5px] leading-6 text-muted-foreground">
            {tr(
              "محوّل الوسائط الفاخر — من يوتيوب إلى روابط MP3 وMP4 مباشرة أنيقة وعملية.",
              "The premium media converter — YouTube to elegant, practical direct MP3 & MP4 links."
            )}
          </p>

          <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-[13px] text-muted-foreground" aria-label={tr("روابط التذييل", "Footer links")}>
            <a href="#converter" className="transition-colors hover:text-foreground">{tr("المحوّل", "Converter")}</a>
            <a href="#how" className="transition-colors hover:text-foreground">{tr("كيف يعمل", "How it works")}</a>
            <a href="#features" className="transition-colors hover:text-foreground">{tr("المميزات", "Features")}</a>
            <a href="#faq" className="transition-colors hover:text-foreground">{tr("الأسئلة", "FAQ")}</a>
            <InfoDialogs />
          </nav>

          {/* Share the tool */}
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground/70">
              <QrCode className="h-3 w-3" />
              {tr("شارك الأداة", "Share the tool")}
            </span>
            {socials.map((s) => (
              <a
                key={s.key}
                href={s.href}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={s.label}
                className={`flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-muted-foreground transition-all duration-300 ${s.hover}`}
              >
                <s.icon className="h-4 w-4" strokeWidth={1.9} />
              </a>
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[11.5px] text-muted-foreground/70">
            <span className="inline-flex items-center gap-1.5">
              <Zap className="h-3 w-3 text-[#e9a23b]/60" />
              ELMINYAWE Engine v3.0
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3 w-3 text-[#2dd4a7]/60" />
              {tr("بدون تتبع ولا تسجيل", "No tracking, no sign-up")}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Heart className="h-3 w-3 text-[#f0554d]/60" />
              {tr("صُنع بشغف للمحتوى العربي", "Crafted with passion for Arabic content")}
            </span>
          </div>

          <div className="h-px w-24 bg-gradient-to-r from-transparent via-white/15 to-transparent" />

          <p className="text-[11px] text-muted-foreground/50">
            © {new Date().getFullYear()} ELMINYAWE —{" "}
            {tr(
              "جميع الحقوق محفوظة. استخدم المحتوى الذي تملك حقوقه فقط.",
              "All rights reserved. Only use content you own the rights to."
            )}
          </p>
        </div>
      </div>
    </footer>
  )
}
