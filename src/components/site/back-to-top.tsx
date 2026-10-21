"use client"

import { useEffect, useState } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowUp } from "lucide-react"
import { useLang } from "@/lib/i18n"

export function BackToTop() {
  const { tr } = useLang()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 700)
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    return () => window.removeEventListener("scroll", onScroll)
  }, [])

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          type="button"
          initial={{ opacity: 0, y: 16, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 16, scale: 0.9 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          /* Stacked ABOVE the shortcuts FAB (bottom-left) — no overlap. */
          className="glass glass-hover fixed bottom-[4.75rem] left-5 z-40 flex h-11 w-11 items-center justify-center rounded-2xl"
          aria-label={tr("العودة إلى الأعلى", "Back to top")}
        >
          <ArrowUp className="h-5 w-5 text-[#f0c274]" strokeWidth={2.2} />
          <span className="absolute inset-0 -z-10 rounded-2xl bg-[#e9a23b]/10 blur-md" aria-hidden="true" />
        </motion.button>
      )}
    </AnimatePresence>
  )
}
