"use client"

import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { TrendingUp, Cpu, Music4, Film } from "lucide-react"
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip,
} from "recharts"
import { cn } from "@/lib/utils"
import { useLang, engineDisplayName, type Lang } from "@/lib/i18n"

interface DayRow { date: string; count: number; mb: number }
interface EngineRow { engine: string; count: number }

interface InsightsData {
  days: DayRow[]
  byEngine: EngineRow[]
  mp3: number
  mp4: number
}

const AR_DAYS = ["الأحد", "الإثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"]
const EN_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

function dayLabel(date: string, lang: Lang): string {
  const d = new Date(date + "T12:00:00")
  return lang === "en" ? EN_DAYS[d.getDay()] : AR_DAYS[d.getDay()].slice(0, 6)
}

/* Gold tooltip matching the glass theme */
function ChartTooltip({ active, payload, label }: {
  active?: boolean
  payload?: Array<{ value?: number | string; name?: string }>
  label?: string
}) {
  const { lang, tr, isRTL } = useLang()
  if (!active || !payload?.length) return null
  const v = Number(payload[0]?.value ?? 0)
  return (
    <div className={cn("glass rounded-xl px-3 py-2 shadow-xl", isRTL ? "text-right" : "text-left")} dir={lang === "ar" ? "rtl" : "ltr"}>
      <p className="text-[11px] font-bold text-[#f0c274]">{label}</p>
      <p className="font-mono text-[12px] font-bold text-foreground" dir="ltr">
        {v} {payload[0]?.name === "mb" ? "MB" : tr("تحويل", "conversions")}
      </p>
    </div>
  )
}

export function Insights({ refreshKey = 0 }: { refreshKey?: number }) {
  const { lang, tr, isRTL } = useLang()
  const [data, setData] = useState<InsightsData | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/stats")
      .then((r) => r.json())
      .then((res) => {
        if (!cancelled && res.ok && res.insights) setData(res.insights)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [refreshKey])

  if (!data) return null

  const total = data.days.reduce((s, d) => s + d.count, 0)
  const maxEngine = Math.max(1, ...data.byEngine.map((e) => e.count))
  const weekMax = Math.max(1, ...data.days.map((d) => d.count))

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="grid gap-3 sm:grid-cols-2"
      aria-label={tr("رؤى الاستخدام", "Usage insights")}
    >
      {/* Weekly activity chart */}
      <div className="glass relative overflow-hidden rounded-2xl p-5">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(233,162,59,0.4), transparent)" }} />
        <div className="mb-1 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-[#e9a23b]/80" strokeWidth={1.9} />
            <h4 className="font-display text-[13.5px] font-bold">{tr("نشاط آخر 7 أيام", "Last 7 days of activity")}</h4>
          </div>
          <span className="rounded-md border border-[#e9a23b]/25 bg-[#e9a23b]/8 px-2 py-0.5 font-mono text-[10.5px] font-bold text-[#f0c274]" dir="ltr">
            {total} {tr("تحويل", total === 1 ? "conversion" : "conversions")}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground">{tr("عدد التحويلات المكتملة يومًا بيوم", "Completed conversions, day by day")}</p>
        <div className="mt-4 h-[86px] w-full" dir="ltr">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data.days} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="goldArea" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#e9a23b" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#e9a23b" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tickFormatter={(value) => dayLabel(String(value), lang)}
                tick={{ fill: "rgba(232,228,220,0.45)", fontSize: 10, fontFamily: "var(--font-mono)" }}
                axisLine={false}
                tickLine={false}
                interval={0}
              />
              <YAxis hide domain={[0, weekMax + 1]} />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: "rgba(233,162,59,0.25)", strokeDasharray: "3 3" }} />
              <Area
                type="monotone"
                dataKey="count"
                stroke="#e9a23b"
                strokeWidth={2}
                fill="url(#goldArea)"
                dot={{ r: 2.5, fill: "#ffd98e", strokeWidth: 0 }}
                activeDot={{ r: 4, fill: "#ffd98e", stroke: "#e9a23b", strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Engines + formats distribution */}
      <div className="glass relative overflow-hidden rounded-2xl p-5">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(233,162,59,0.4), transparent)" }} />
        <div className="mb-1 flex items-center gap-2">
          <Cpu className="h-4 w-4 text-[#e9a23b]/80" strokeWidth={1.9} />
          <h4 className="font-display text-[13.5px] font-bold">{tr("توزيع المحركات والصيغ", "Engine & format distribution")}</h4>
        </div>
        <p className="text-[11px] text-muted-foreground">{tr("من الذي أنجز التحويلات — وبأي صيغة", "Which engine delivered each conversion — and in which format")}</p>

        <div className="mt-4 flex flex-col gap-2.5">
          {data.byEngine.map((e) => (
            <div key={e.engine} className="flex items-center gap-3">
              <span
                className={cn("w-[118px] shrink-0 truncate font-mono text-[11px] font-bold text-foreground/85", isRTL ? "text-right" : "text-left")}
                dir={isRTL ? "rtl" : "ltr"}
                title={engineDisplayName(e.engine, lang)}
              >
                {engineDisplayName(e.engine, lang)}
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/6">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#b87a1e] via-[#e9a23b] to-[#ffd98e] shadow-[0_0_10px_rgba(233,162,59,0.35)] transition-[width] duration-700"
                  style={{ width: `${Math.max(6, (e.count / maxEngine) * 100)}%` }}
                />
              </div>
              <span className={cn("w-6 shrink-0 font-mono text-[11px] font-bold text-[#f0c274]", isRTL ? "text-left" : "text-right")} dir="ltr">{e.count}</span>
            </div>
          ))}
        </div>

        <div className="divider-gold my-4" />

        <div className="grid grid-cols-2 gap-2">
          <div className={cn("flex items-center gap-2.5 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5")}>
            <Music4 className="h-4 w-4 text-[#f0c274]" strokeWidth={1.9} />
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-base font-bold text-foreground" dir="ltr">{data.mp3}</span>
              <span className="text-[10.5px] text-muted-foreground">MP3</span>
            </div>
          </div>
          <div className="flex items-center gap-2.5 rounded-xl border border-white/8 bg-white/[0.03] px-3 py-2.5">
            <Film className="h-4 w-4 text-[#f0c274]" strokeWidth={1.9} />
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-base font-bold text-foreground" dir="ltr">{data.mp4}</span>
              <span className="text-[10.5px] text-muted-foreground">MP4</span>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
