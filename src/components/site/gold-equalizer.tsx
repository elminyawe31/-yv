"use client"

import { useEffect, useState } from "react"

/**
 * Gold equalizer — the audio signature of ELMINYAWE.
 * Bars dance while the media plays and settle when paused.
 * `autoStart` matches autoplaying audio (modal previews); otherwise bars
 * wake up on the first `play` event.
 */
const HEIGHTS = [0.9, 0.55, 0.75, 0.4, 1, 0.6, 0.85, 0.5, 0.7, 0.45, 0.8, 0.58, 0.65, 0.95, 0.5, 0.75]

export function GoldEqualizer({
  audioRef,
  autoStart = false,
}: {
  audioRef?: React.RefObject<HTMLAudioElement | null>
  autoStart?: boolean
}) {
  const [playing, setPlaying] = useState(autoStart)

  useEffect(() => {
    const audio = audioRef?.current
    if (!audio) return
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    audio.addEventListener("play", onPlay)
    audio.addEventListener("pause", onPause)
    return () => {
      audio.removeEventListener("play", onPlay)
      audio.removeEventListener("pause", onPause)
    }
  }, [audioRef])

  return (
    <div
      className="flex h-14 shrink-0 items-end gap-[3px] rounded-xl border border-[#e9a23b]/20 bg-[#e9a23b]/[0.05] px-2.5 py-2"
      aria-hidden="true"
    >
      {HEIGHTS.map((h, i) => (
        <span
          key={i}
          className="eq-bar w-[3px] rounded-full"
          style={
            {
              "--h": h,
              "--d": `${(i % 8) * 0.11}s`,
              animationPlayState: playing ? "running" : "paused",
              opacity: playing ? 1 : 0.4,
              transition: "opacity 0.5s ease",
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  )
}
