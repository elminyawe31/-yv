"use client"

import { useEffect, useRef, useState } from "react"
import { motion, useInView } from "framer-motion"
import { AudioLines, Film, Gauge, ShieldCheck, FileUp, Sparkles, Database, Cpu } from "lucide-react"
import { useLang } from "@/lib/i18n"

interface LiveStats {
  totalConversions: number
  totalMB: number
  enginesActive: number
  enginesTotal: number
}

/** Smooth count-up that starts when the element scrolls into view.
 *  No negative rootMargin: a dead-zone near the viewport edge left the
 *  bottom-row stat cards stuck on "0" on mobile until the user scrolled. */
function CountUp({ value, suffix = "", decimals = 0 }: { value: number; suffix?: string; decimals?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: "0px" })
  const [display, setDisplay] = useState(0)

  useEffect(() => {
    if (!inView) return
    const duration = 1400
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(value * eased)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [inView, value])

  return (
    <span ref={ref} className="font-display text-2xl font-bold text-foreground" dir="ltr">
      {display.toFixed(decimals)}
      {suffix}
    </span>
  )
}

const fadeUp = {
  hidden: { opacity: 0, y: 28 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: 0.12 * i, duration: 0.8, ease: [0.22, 1, 0.36, 1] as const },
  }),
}

/* Floating gold motes — pure CSS, subtle ambient depth */
const MOTES = [
  { left: "12%", top: "18%", size: 3, delay: "0s", dur: "26s" },
  { left: "28%", top: "62%", size: 2, delay: "-8s", dur: "32s" },
  { left: "47%", top: "12%", size: 2.5, delay: "-14s", dur: "24s" },
  { left: "66%", top: "55%", size: 2, delay: "-4s", dur: "30s" },
  { left: "82%", top: "24%", size: 3, delay: "-18s", dur: "28s" },
  { left: "90%", top: "68%", size: 2, delay: "-10s", dur: "34s" },
  { left: "8%", top: "80%", size: 2.5, delay: "-22s", dur: "26s" },
  { left: "55%", top: "82%", size: 2, delay: "-2s", dur: "36s" },
]

/* Drifting musical notes — the site's animated signature */
const NOTES = [
  { left: "6%",  bottom: "12%", glyph: "♪", size: 18, delay: "0s",   dur: "14s", opacity: 0.5 },
  { left: "16%", bottom: "22%", glyph: "♫", size: 13, delay: "-4s",  dur: "17s", opacity: 0.35 },
  { left: "84%", bottom: "10%", glyph: "♫", size: 16, delay: "-8s",  dur: "15s", opacity: 0.45 },
  { left: "92%", bottom: "26%", glyph: "♪", size: 12, delay: "-2s",  dur: "19s", opacity: 0.3 },
  { left: "76%", bottom: "34%", glyph: "♩", size: 14, delay: "-11s", dur: "13s", opacity: 0.4 },
  { left: "24%", bottom: "40%", glyph: "♪", size: 11, delay: "-6s",  dur: "21s", opacity: 0.3 },
]

export function Hero() {
  const { lang, tr } = useLang()
  const [stats, setStats] = useState<LiveStats | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/stats")
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled && data.ok) setStats(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const statCards = stats
    ? [
        { icon: Database, node: <CountUp value={stats.totalConversions} />, unit: tr("تحويل", "conversions"), label: tr("تحويل مكتمل على المنصة", "Conversions completed on the platform"), live: true },
        { icon: Gauge, node: <CountUp value={stats.totalMB} decimals={1} />, unit: "MB", label: tr("حجم الوسائط المحوَّلة", "Media converted in total"), live: true },
        { icon: Cpu, node: <CountUp value={stats.enginesActive} suffix={`/${stats.enginesTotal}`} />, unit: tr("محرك", "engines"), label: tr("محركات تحويل نشطة الآن", "Conversion engines live right now"), live: true },
        { icon: AudioLines, node: <span className="font-display text-2xl font-bold text-foreground">320</span>, unit: "kbps", label: tr("أعلى جودة صوت", "Peak audio quality"), live: false },
      ]
    : [
        { icon: Gauge, node: <span className="font-display text-2xl font-bold text-foreground">~60</span>, unit: tr("ثانية", "sec"), label: tr("متوسط التحويل", "Average conversion") },
        { icon: AudioLines, node: <span className="font-display text-2xl font-bold text-foreground">320</span>, unit: "kbps", label: tr("أعلى جودة صوت", "Peak audio quality") },
        { icon: Film, node: <span className="font-display text-2xl font-bold text-foreground">1080</span>, unit: "p", label: tr("دقة الفيديو", "Video resolution") },
        { icon: ShieldCheck, node: <span className="font-display text-2xl font-bold text-foreground">0</span>, unit: "", label: tr("تسجيل أو تتبع", "Sign-up or tracking") },
      ]

  /* Headline split into animated words (word-by-word reveal). */
  const headlineTop = tr("حوّل أي فيديو إلى", "Convert any video into")
  const headlineGold = tr("رابط مباشر فوري", "an instant direct link")

  return (
    <section id="top" className="relative overflow-hidden pt-36 pb-16 sm:pt-44 sm:pb-20">
      {/* Floating gold motes */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        {MOTES.map((m, i) => (
          <span
            key={i}
            className="mote absolute rounded-full"
            style={{
              left: m.left,
              top: m.top,
              width: m.size,
              height: m.size,
              animationDelay: m.delay,
              animationDuration: m.dur,
            }}
          />
        ))}
      </div>

      {/* Drifting music notes */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        {NOTES.map((n, i) => (
          <span
            key={i}
            className="hero-note absolute select-none font-display font-bold text-[#f0c274]"
            style={{
              left: n.left,
              bottom: n.bottom,
              fontSize: n.size,
              opacity: n.opacity,
              animationDelay: n.delay,
              animationDuration: n.dur,
            }}
          >
            {n.glyph}
          </span>
        ))}
      </div>

      <div className="mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mx-auto max-w-3xl text-center">
          {/* Glow behind headline */}
          <div
            className="pointer-events-none absolute left-1/2 top-24 h-[420px] w-[720px] -translate-x-1/2"
            style={{
              background:
                "radial-gradient(closest-side, rgba(233,162,59,0.09), transparent 72%)",
            }}
            aria-hidden="true"
          />
          {/* Badge */}
          <motion.div variants={fadeUp} initial="hidden" animate="show" custom={0}>
            <div className="hero-badge mx-auto inline-flex items-center gap-2.5 rounded-full border border-[#e9a23b]/25 bg-[#e9a23b]/[0.07] px-4 py-2 shadow-[0_4px_30px_rgba(0,0,0,0.35)] backdrop-blur-xl">
              <span className="relative flex h-2 w-2">
                <span className="absolute h-full w-full animate-ping rounded-full bg-[#f0c274] opacity-60" />
                <span className="relative h-2 w-2 rounded-full bg-[#f0c274]" />
              </span>
              <span className="text-[13px] font-semibold text-[#f0c274]">
                {tr("محوّل الوسائط الفاخر — من يوتيوب إلى رابط مباشر", "Premium media converter — YouTube to a direct link")}
              </span>
            </div>
          </motion.div>

          {/* Headline — word-by-word cinematic reveal */}
          <h1
            className="mt-7 font-display text-4xl font-extrabold leading-[1.25] tracking-tight sm:text-6xl sm:leading-[1.2]"
            aria-label={`${headlineTop} ${headlineGold}`}
          >
            <span className="block">
              {headlineTop.split(" ").map((word, i) => (
                <motion.span
                  key={`${word}-${i}`}
                  initial={{ opacity: 0, y: 26, filter: "blur(6px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  transition={{ delay: 0.15 + i * 0.09, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                  className="inline-block"
                  aria-hidden="true"
                >
                  {word}
                  {"\u00A0"}
                </motion.span>
              ))}
            </span>
            <span className="mt-1 block">
              {headlineGold.split(" ").map((word, i) => (
                <motion.span
                  key={`${word}-${i}`}
                  initial={{ opacity: 0, y: 26, scale: 0.92, filter: "blur(8px)" }}
                  animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                  transition={{ delay: 0.45 + i * 0.1, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
                  className="text-gold-gradient text-gold-shimmer inline-block"
                  aria-hidden="true"
                >
                  {word}
                  {"\u00A0"}
                </motion.span>
              ))}
            </span>
          </h1>

          {/* Sub */}
          <motion.p
            variants={fadeUp}
            initial="hidden"
            animate="show"
            custom={2}
            className="mx-auto mt-6 max-w-xl text-base leading-8 text-muted-foreground sm:text-lg sm:leading-9"
          >
            {tr(
              "الصق رابط يوتيوب، اختر MP3 بجودة استوديو أو MP4 بدقة عالية، واحصل خلال لحظات على رابط أنيق من نطاق ELMINYAWE يعمل للأبد — بدون تسجيل، وبدون خطوات زائدة.",
              "Paste a YouTube link, choose studio-quality MP3 or high-resolution MP4, and get an elegant ELMINYAWE link within seconds — built to last forever, with no sign-up and no extra steps."
            )}
          </motion.p>

          {/* CTA row */}
          <motion.div
            variants={fadeUp}
            initial="hidden"
            animate="show"
            custom={3}
            className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row"
          >
            <a
              href="#converter"
              className="btn-gold shine group inline-flex h-12 w-full items-center justify-center gap-2.5 rounded-2xl px-8 text-[15px] font-bold sm:w-auto"
            >
              <FileUp className="h-4.5 w-4.5 transition-transform duration-300 group-hover:-translate-y-0.5" strokeWidth={2.4} />
              {tr("جرّب التحويل الآن", "Try converting now")}
            </a>
            <a
              href="#how"
              className="btn-ghost inline-flex h-12 w-full items-center justify-center rounded-2xl px-8 text-[15px] font-semibold hover:border-[#e9a23b]/35 hover:bg-[#e9a23b]/[0.06] hover:text-[#f0c274] sm:w-auto"
            >
              {tr("شاهد كيف يعمل", "See how it works")}
            </a>
          </motion.div>
        </div>

        {/* Stats */}
        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="show"
          custom={4}
          className="mx-auto mt-16 grid max-w-4xl grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4"
        >
          {statCards.map((stat) => (
            <div
              key={stat.label}
              className="glass glass-hover relative rounded-2xl px-4 py-5 text-center"
            >
              {stat.live && (
                <span className="absolute left-3 top-3 flex h-1.5 w-1.5 rounded-full bg-[#2dd4a7] shadow-[0_0_8px_rgba(45,212,167,0.8)]" aria-hidden="true" />
              )}
              <stat.icon className="mx-auto h-5 w-5 text-[#e9a23b]/80" strokeWidth={1.8} />
              <div className="mt-3 flex items-baseline justify-center gap-1">
                {stat.node}
                {stat.unit && (
                  <span className="text-xs font-semibold text-muted-foreground">{stat.unit}</span>
                )}
              </div>
              <div className="mt-1 text-[11px] font-medium tracking-wide text-muted-foreground">
                {stat.label}
              </div>
            </div>
          ))}
        </motion.div>

        {/* Trust marquee — cassette-futurism strip */}
        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="show"
          custom={5}
          className="marquee-mask mx-auto mt-8 max-w-4xl overflow-hidden border-y border-white/6 py-3.5"
          aria-hidden="true"
        >
          <div className="marquee-track">
            {[0, 1].map((copy) => (
              <div key={copy} className="flex items-center" aria-hidden={copy === 1}>
                {(lang === "ar"
                  ? [
                      "MP3 بجودة استوديو 320kbps",
                      "MP4 بدقة Full HD 1080p",
                      "بدون تسجيل أو حساب",
                      "روابط مباشرة دائمة",
                      "محركات متعددة بتجاوب تلقائي",
                      "قائمة دفعات لتحويل متعدد",
                      "رمز QR للنقل للهاتف",
                      "خصوصية مدمجة بالتصميم",
                    ]
                  : [
                      "Studio-grade 320kbps MP3",
                      "Full HD 1080p MP4",
                      "No sign-up or account",
                      "Permanent direct links",
                      "Multi-engine auto failover",
                      "Batch queue for bulk converts",
                      "QR codes for phone transfer",
                      "Privacy by design",
                    ]
                ).map((t) => (
                  <span key={t} className="marquee-item">
                    <span className="marquee-dot" />
                    {t}
                  </span>
                ))}
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  )
}
