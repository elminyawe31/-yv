import path from 'node:path'

export const BRAND = 'ELMINYAWE'

function positiveInt(value: string | undefined, fallback: number, upper: number): number {
  const n = Number(value)
  return Number.isSafeInteger(n) && n > 0 && n <= upper ? n : fallback
}

export const MAX_FILE_MB = positiveInt(process.env.MAX_FILE_MB, 80, 200)
export const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024
export const MAX_CONCURRENT = positiveInt(process.env.MAX_CONCURRENT_CONVERSIONS, 1, 3)
export const CONVERSION_DEADLINE_MS = positiveInt(process.env.CONVERSION_DEADLINE_MS, 255_000, 270_000)
export const HOBBY_TIMEOUT_MESSAGE =
  'انتهت مهلة التحويل. جرّب مقطعًا أقصر أو جودة أقل.'

/** The owner explicitly chose to publish this Catbox userhash in the original source. */
export const CATBOX_USERHASH = process.env.CATBOX_USERHASH || '2bb89d603e68f00eb2dc956b5'

/** Local media fallback directory (used when Catbox is unreachable).
 *  On Vercel only /tmp is writable, so local mirrors live there. */
export const MEDIA_DIR =
  process.env.MEDIA_DIR ||
  (process.env.VERCEL ? '/tmp/elminyawe-media' : path.join(process.cwd(), 'db', 'media'))

export const QUALITY_CHOICES = {
  mp3: ['128K', '192K', '256K', '320K'] as const,
  mp4: ['360', '480', '720', '1080'] as const,
}

export type MediaExt = 'mp3' | 'mp4'

/** Resolve the yt-dlp binary across environments. */
export function resolveYtdlp(): string {
  if (process.env.YTDLP_PATH) return process.env.YTDLP_PATH
  return '/home/z/.venv/bin/yt-dlp'
}

export function resolveFfmpeg(): string {
  return process.env.FFMPEG_PATH || 'ffmpeg'
}

export function sanitizeName(name: string | undefined | null): string {
  return (
    String(name || BRAND)
      .replace(/[\u0000-\u001f\u007f\\/:*?"<>|]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/^\.+|\.+$/g, '')
      .trim()
      .slice(0, 80) || BRAND
  )
}

export function formatDuration(seconds: number): string {
  if (!seconds || !Number.isFinite(seconds)) return '—'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}
