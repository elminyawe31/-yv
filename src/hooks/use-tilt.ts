"use client"

import { useCallback, useRef } from "react"

/**
 * 3D perspective tilt that follows the pointer.
 * Attach the returned ref to a card element that has the `.tilt-card` class
 * (wrapped in a `.tilt-scene` parent). A `.tilt-glow` child will also track
 * the pointer position via --mx/--my custom properties.
 *
 * @param maxDeg maximum rotation in degrees (default 6)
 */
export function useTilt<T extends HTMLElement = HTMLDivElement>(maxDeg = 6) {
  const ref = useRef<T | null>(null)
  const tilting = useRef(false)

  const onPointerMove = useCallback(
    (e: React.PointerEvent<T>) => {
      const el = ref.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const px = (e.clientX - rect.left) / rect.width
      const py = (e.clientY - rect.top) / rect.height
      const rx = (0.5 - py) * maxDeg * 2
      const ry = (px - 0.5) * maxDeg * 2
      el.style.setProperty("transform", `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`)
      el.style.setProperty("--mx", `${(px * 100).toFixed(1)}%`)
      el.style.setProperty("--my", `${(py * 100).toFixed(1)}%`)
      if (!tilting.current) {
        tilting.current = true
        el.setAttribute("data-tilting", "true")
      }
    },
    [maxDeg],
  )

  const onPointerLeave = useCallback(() => {
    const el = ref.current
    if (!el) return
    el.style.removeProperty("transform")
    el.setAttribute("data-tilting", "false")
    tilting.current = false
  }, [])

  return { ref, onPointerMove, onPointerLeave }
}
