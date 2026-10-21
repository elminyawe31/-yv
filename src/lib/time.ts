/** Shared time helpers used by the converter and the batch queue. */

/** Parse "1:30", "02:15", "90", "90.5", or Arabic-digit variants into seconds. Returns null when invalid. */
export function parseTimeInput(raw: string): number | null {
  const s = raw.trim().replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
  if (!s) return null
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s)
  if (/^\d{1,2}:\d{1,2}(:\d{1,2})?$/.test(s)) {
    const parts = s.split(":").map(Number)
    return parts.reduce((acc, p) => acc * 60 + p, 0)
  }
  return null
}

/** Format seconds as m:ss or h:mm:ss. */
export function formatTime(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
  return `${m}:${String(sec).padStart(2, "0")}`
}

/** Extract a YouTube playlist id from any URL form (watch?v=..&list=.., /playlist?list=..). */
export function extractPlaylistId(rawUrl: string): string | null {
  try {
    const u = new URL(rawUrl)
    if (!/(^|\.)youtube\.com$|(^|\.)youtu\.be$/i.test(u.hostname)) return null
    return u.searchParams.get("list")
  } catch {
    return null
  }
}
