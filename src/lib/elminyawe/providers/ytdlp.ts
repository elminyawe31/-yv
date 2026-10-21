import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { run } from '../runner'
import { resolveFfmpeg, resolveYtdlp, sanitizeName, MAX_FILE_BYTES } from '../brand'
import type { ConvertContext, DownloadProvider, ProviderFile } from './types'

/* ============================================================
 *  Local yt-dlp provider — the original ELMINYAWE engine.
 *
 *  YouTube increasingly challenges datacenter IPs with
 *  "Sign in to confirm you're not a bot". A Netscape-format
 *  cookies file unlocks it:
 *    - YTDLP_COOKIES_FILE  → absolute path to cookies.txt
 *    - YTDLP_COOKIES_B64   → base64 of the file (safer for envs)
 *    - db/cookies.txt      → auto-detected default location
 * ============================================================ */

const COOKIE_CANDIDATES = [
  () => process.env.YTDLP_COOKIES_FILE || null,
  () => {
    const b64 = process.env.YTDLP_COOKIES_B64 || process.env.YT_COOKIES_B64
    if (!b64) return null
    try {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elminyawe-cookies-'))
      const file = path.join(dir, 'cookies.txt')
      fs.writeFileSync(file, Buffer.from(b64, 'base64').toString('utf8'), { mode: 0o600 })
      return file
    } catch {
      return null
    }
  },
  () => {
    const file = path.join(process.cwd(), 'db', 'cookies.txt')
    return fs.existsSync(file) ? file : null
  },
]

function findCookiesFile(): string | null {
  for (const candidate of COOKIE_CANDIDATES) {
    try {
      const file = candidate()
      if (file && fs.existsSync(file)) return file
    } catch {
      /* ignore */
    }
  }
  return null
}

export function ytdlpCookiesConfigured(): boolean {
  return findCookiesFile() !== null
}

export const ytdlpProvider: DownloadProvider = {
  id: 'ytdlp',
  label: 'المحرك 3 — محرك محلي',
  techLabel: 'yt-dlp',
  kind: 'local',
  unavailableReason(): string | null {
    /* Fast skip where the binary can't exist (Vercel serverless, containers
     * without yt-dlp) — no point burning seconds on a spawn that will fail. */
    try {
      const bin = resolveYtdlp()
      if (!fs.existsSync(bin)) return 'yt-dlp غير مثبت على هذا الخادم.'
    } catch {
      return 'yt-dlp غير مثبت على هذا الخادم.'
    }
    return null // attemptable; may still fail per-video (bot checks)
  },
  async convert(ctx: ConvertContext): Promise<ProviderFile> {
    ctx.onEvent({ stage: 'resolve', message: 'تحليل الفيديو عبر yt-dlp المحلي...' })

    const template = path.join(ctx.workDir, `ELMINYAWE.%(ext)s`)
    const common = [
      '--ignore-config',
      '--no-cache-dir',
      '--no-playlist',
      '--no-warnings',
      '--newline',
      '--socket-timeout',
      '20',
      '--retries',
      '3',
      '--max-filesize',
      String(MAX_FILE_BYTES),
    ]
    const ffmpegPath = resolveFfmpeg()
    if (ffmpegPath !== 'ffmpeg') common.push('--ffmpeg-location', ffmpegPath)

    const cookies = findCookiesFile()
    if (cookies) {
      common.push('--cookies', cookies)
      ctx.onEvent({ stage: 'resolve', message: 'استخدام ملف كوكيز يوتيوب مرفق بالخادم...' })
    }

    const format =
      ctx.ext === 'mp3'
        ? ['-x', '--audio-format', 'mp3', '--audio-quality', ctx.quality]
        : [
            '-f',
            `bv*[height<=${ctx.quality}][ext=mp4]+ba[ext=m4a]/b[height<=${ctx.quality}][ext=mp4]`,
            '--merge-output-format',
            'mp4',
          ]

    const timeoutMs = Math.max(10_000, Math.min(9 * 60_000, ctx.deadlineAt - Date.now()))
    const { stdout } = await run(
      resolveYtdlp(),
      [...common, ...format, '--print', '%(title)s', '--print', 'after_move:filepath', '-o', template, ctx.videoUrl],
      {
        timeout: timeoutMs,
        dir: ctx.workDir,
        signal: ctx.signal,
        onStdout: (chunk) => {
          for (const line of chunk.split(/\r?\n/)) {
            const m = line.match(/\[download\]\s+([\d.]+)%/)
            if (m) {
              const percent = Math.min(99, Math.round(parseFloat(m[1])))
              ctx.onEvent({ stage: 'download', percent })
            }
          }
        },
      }
    )

    const lines = stdout.trim().split('\n').filter(Boolean)
    const title = sanitizeName(lines[0] || `YouTube ${ctx.videoId}`)
    const outPath = lines.find((l) => l.startsWith(ctx.workDir)) || ''

    const files = fs
      .readdirSync(ctx.workDir)
      .filter((name) => name.endsWith(`.${ctx.ext}`))
      .map((name) => path.join(ctx.workDir, name))
    const file = outPath && fs.existsSync(outPath) ? outPath : files[0]
    if (!file) throw new Error(`لم ينتج التنزيل ملف ${ctx.ext.toUpperCase()} واحدًا.`)

    return { file, title, quality: ctx.quality }
  },
}
