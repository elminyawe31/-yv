"use client"

import { motion } from "framer-motion"
import { cn } from "@/lib/utils"

/* ---------------- Section heading (eyebrow + gold underline sweep) ---------------- */

export function SectionHead({
  eyebrow,
  title,
  highlight,
  description,
  className,
}: {
  eyebrow: string
  title: string
  highlight: string
  description?: string
  className?: string
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
      className={cn("mx-auto max-w-2xl text-center", className)}
    >
      <span className="eyebrow">
        <span className="eyebrow-line" aria-hidden="true" />
        {eyebrow}
        <span className="eyebrow-line" aria-hidden="true" />
      </span>
      <h2 className="mt-4 font-display text-2xl font-bold sm:text-4xl">
        {title} <span className="text-gold-gradient">{highlight}</span>
      </h2>
      <motion.div
        aria-hidden="true"
        initial={{ scaleX: 0 }}
        whileInView={{ scaleX: 1 }}
        viewport={{ once: true, margin: "-60px" }}
        transition={{ delay: 0.35, duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        className="title-sweep mx-auto mt-5"
      />
      {description && (
        <p className="mt-4 text-sm leading-7 text-muted-foreground sm:text-base sm:leading-8">
          {description}
        </p>
      )}
    </motion.div>
  )
}

/* ---------------- Corner frame ticks (cassette-futurism detail) ---------------- */

const POSITIONS = ["tl", "tr", "bl", "br"] as const

export function CornerTicks({ className }: { className?: string }) {
  return (
    <span className={cn("pointer-events-none absolute inset-0", className)} aria-hidden="true">
      {POSITIONS.map((pos) => (
        <span key={pos} className="corner-tick" data-pos={pos} />
      ))}
    </span>
  )
}
