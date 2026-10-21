import fs from 'node:fs'
import path from 'node:path'
import { MAX_FILE_BYTES } from '../brand'
import { solveTurnstile, getSolverInfo, TURNSTILE_SITE_KEY, TURNSTILE_PAGE_URL } from './turnstile'
import type { ConvertContext, DownloadProvider, ProviderFile, VideoInfoResult } from './types'

/* ============================================================
 *  marisaenterprises.com provider — clickapi.net / api.cdnframe.com (v5)
 *
 *  «المحرك 1» — the protection-bypass engine, first in the chain.
 *  marisaenterprises.com embeds clickapi.net widgets; the backing
 *  API is api.cdnframe.com:
 *    1) POST /api/v5/auth                     → { token, expiresIn }   (free)
 *    2) GET  /api/v5/info/{videoId}           → { title, duration, formats{audio,video} }
 *    3) POST /api/v5/convert {token, turnstile} → { jobId }
 *       └─ requires a Cloudflare Turnstile token (sitekey 0x4AAAAAAB7R_--firW0k1YT,
 *          page https://clickapi.net/) solved via CapSolver / 2Captcha.
 *    4) GET  /api/v5/status/{jobId}           → { status, progress, step, downloadUrl, title, fileFormat }
 *    5) GET  downloadUrl                       → media bytes
 * ============================================================ */

const API_BASE = process.env.CDNFRAME_API_BASE || 'https://api.cdnframe.com'
export { TURNSTILE_SITE_KEY, TURNSTILE_PAGE_URL }
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/* ---------------- auth token cache ---------------- */

interface AuthState {
  token: string
  expiresAt: number
}
let authCache: AuthState | null = null
let authInflight: Promise<string> | null = null

async function apiHeaders(): Promise<Record<string, string>> {
  return {
    'User-Agent': UA,
    Accept: 'application/json',
    Origin: 'https://clickapi.net',
    Referer: 'https://clickapi.net/',
    Authorization: `Bearer ${await getAuthToken()}`,
  }
}

async function getAuthToken(): Promise<string> {
  if (authCache && authCache.expiresAt > Date.now() + 30_000) return authCache.token
  if (authInflight) return authInflight
  authInflight = (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/v5/auth`, {
        method: 'POST',
        headers: { 'User-Agent': UA, Accept: 'application/json', Origin: 'https://clickapi.net' },
        signal: AbortSignal.timeout(20_000),
      })
      const data = (await res.json().catch(() => null)) as { success?: boolean; token?: string; expiresIn?: number } | null
      if (!res.ok || !data?.token) throw new Error('المحرك 1: فشل التوثيق مع خدمة التحويل.')
      authCache = { token: data.token, expiresAt: Date.now() + (data.expiresIn ?? 600) * 1000 }
      return data.token
    } finally {
      authInflight = null
    }
  })()
  return authInflight
}

/* ---------------- public: video info (no captcha needed) ---------------- */

interface CdnframeFormat {
  quality: number
  codec: string
  ext: string
  token: string
}

export async function cdnframeInfo(videoId: string): Promise<VideoInfoResult | null> {
  try {
    const res = await fetch(`${API_BASE}/api/v5/info/${encodeURIComponent(videoId)}`, {
      headers: await apiHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    })
    if (!res.ok) return null
    const data = (await res.json().catch(() => null)) as
      | {
          videoId?: string
          title?: string
          duration?: string
          formats?: { audio?: CdnframeFormat[]; video?: CdnframeFormat[] }
        }
      | null
    if (!data?.title) return null
    return {
      title: data.title,
      duration: parseDuration(String(data.duration ?? '')),
      audioQualities: (data.formats?.audio ?? []).map((f) => f.quality).filter((q) => q > 0),
      videoQualities: (data.formats?.video ?? []).map((f) => f.quality).filter((q) => q > 0),
    }
  } catch {
    return null
  }
}

export function parseDuration(text: string): number {
  const parts = text.split(':').map((p) => Number(p))
  if (parts.some((p) => !Number.isFinite(p))) return 0
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return parts[0] ?? 0
}

/* ---------------- provider ---------------- */

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function pickFormatToken(
  formats: CdnframeFormat[] | undefined,
  ext: 'mp3' | 'mp4',
  wantedQuality: string
): CdnframeFormat | null {
  if (!formats?.length) return null
  const wanted = Number(wantedQuality.replace(/[^0-9]/g, ''))
  const pool = formats.filter((f) => f.ext === ext)
  if (!pool.length) return null
  if (Number.isFinite(wanted) && wanted > 0) {
    const exact = pool.find((f) => f.quality === wanted)
    if (exact) return exact
    const below = [...pool].sort((a, b) => b.quality - a.quality).find((f) => f.quality <= wanted)
    if (below) return below
  }
  return [...pool].sort((a, b) => b.quality - a.quality)[0]
}

async function streamToFile(
  downloadUrl: string,
  ctx: ConvertContext,
  fileFormat: string
): Promise<string> {
  const target = path.join(ctx.workDir, `cdnframe-out.${fileFormat || ctx.ext}`)
  const res = await fetch(downloadUrl, {
    headers: { 'User-Agent': UA, Referer: 'https://clickapi.net/' },
    redirect: 'follow',
    signal: ctx.signal ?? AbortSignal.timeout(240_000),
  })
  if (!res.ok || !res.body) throw new Error('المحرك 1: فشل تنزيل الملف.')

  const declared = Number(res.headers.get('content-length')) || 0
  const out = fs.createWriteStream(target)
  const reader = res.body.getReader()
  let received = 0
  let lastEmitted = -1
  /* Drain-wait that also settles on close/error — prevents a backpressured
   * download from hanging forever while holding the conversion slot. */
  const waitDrain = () =>
    new Promise<void>((resolve) => {
      const done = () => {
        out.off('drain', done)
        out.off('close', done)
        out.off('error', done)
        resolve()
      }
      out.once('drain', done)
      out.once('close', done)
      out.once('error', done)
    })
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > MAX_FILE_BYTES) {
        throw new Error(`تجاوز الملف الحد الأقصى (${Math.floor(MAX_FILE_BYTES / 1048576)}MB).`)
      }
      if (!out.write(value)) {
        await waitDrain()
        if (out.destroyed) throw new Error('أُلغِيَ تنزيل الملف من المحرك 1.')
      }
      const denom = declared || MAX_FILE_BYTES
      const percent = Math.min(99, Math.round((received / denom) * 100))
      if (percent > lastEmitted) {
        lastEmitted = percent
        ctx.onEvent({ stage: 'download', percent })
      }
    }
    await new Promise<void>((resolve, reject) => {
      out.end(() => resolve())
      out.on('error', reject)
    })
  } catch (err) {
    // Release the upstream HTTP connection and the partial file.
    reader.cancel().catch(() => {})
    out.destroy()
    fs.rmSync(target, { force: true })
    throw err
  }
  if (received < 2048) {
    fs.rmSync(target, { force: true })
    throw new Error('المحرك 1: الملف المستلم فارغ أو تالف.')
  }
  return target
}

export const cdnframeProvider: DownloadProvider = {
  id: 'marisa',
  label: 'المحرك 1',
  techLabel: 'engine1',
  kind: 'api',
  async unavailableReason(): Promise<string | null> {
    const solver = await getSolverInfo()
    if (!solver.hasKey) {
      return 'المحرك 1 غير مهيأ على هذا الخادم.'
    }
    return null
  },
  async convert(ctx: ConvertContext): Promise<ProviderFile> {
    if (ctx.signal?.aborted) throw new Error('أُلغِيَ التحويل بعد إغلاق الطلب.')
    ctx.onEvent({ stage: 'resolve', message: 'جلب تفاصيل الفيديو من المحرك 1...', en: 'Fetching video details from Engine 1...' })

    const infoRes = await fetch(`${API_BASE}/api/v5/info/${encodeURIComponent(ctx.videoId)}`, {
      headers: await apiHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    })
    if (!infoRes.ok) throw new Error('المحرك 1: تعذر جلب تفاصيل الفيديو.')
    const info = (await infoRes.json()) as {
      title?: string
      formats?: { audio?: CdnframeFormat[]; video?: CdnframeFormat[] }
    }

    const chosen =
      ctx.ext === 'mp3'
        ? pickFormatToken(info.formats?.audio, 'mp3', ctx.quality)
        : pickFormatToken(info.formats?.video, 'mp4', ctx.quality)
    if (!chosen) throw new Error(`المحرك 1: لا توجد صيغة ${ctx.ext.toUpperCase()} متاحة لهذا الفيديو.`)

    ctx.onEvent({
      stage: 'resolve',
      percent: 10,
      message: 'حل تحدي التحقق الذكي...',
      en: 'Solving the verification challenge...',
    })
    let turnstileToken: string
    try {
      turnstileToken = await solveTurnstile(TURNSTILE_SITE_KEY, TURNSTILE_PAGE_URL, 110_000)
    } catch (err) {
      const msg = String((err as Error).message || err)
      if (msg === 'NO_SOLVER_KEY') throw new Error('المحرك 1: لا يتوفر حل للتحدي على الخادم.')
      throw new Error(`المحرك 1: فشل حل التحدي (${msg.slice(0, 120)})`)
    }

    ctx.onEvent({ stage: 'convert', percent: 18, message: 'بدء التحويل على المحرك 1...', en: 'Starting the conversion on Engine 1...' })
    const convertRes = await fetch(`${API_BASE}/api/v5/convert`, {
      method: 'POST',
      headers: { ...(await apiHeaders()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: chosen.token, turnstile: turnstileToken }),
      signal: AbortSignal.timeout(45_000),
    })
    const convertData = (await convertRes.json().catch(() => null)) as
      | { jobId?: string; message?: string }
      | null
    if (!convertRes.ok || !convertData?.jobId) {
      throw new Error('المحرك 1: رفض بدء التحويل.')
    }

    /* Poll job status until completed / failed. */
    let downloadUrl = ''
    let title = info.title || ''
    let fileFormat: string = ctx.ext
    const deadline = Math.min(ctx.deadlineAt - 5_000, Date.now() + 200_000)
    while (Date.now() < deadline) {
      if (ctx.signal?.aborted) throw new Error('أُلغِيَ التحويل بعد إغلاق الطلب.')
      await sleep(2500)
      const statusRes = await fetch(`${API_BASE}/api/v5/status/${encodeURIComponent(convertData.jobId)}`, {
        headers: await apiHeaders(),
        cache: 'no-store',
        signal: AbortSignal.timeout(20_000),
      })
      if (!statusRes.ok) continue // transient — keep polling
      const status = (await statusRes.json().catch(() => null)) as
        | {
            status?: string
            progress?: number
            step?: string
            downloadUrl?: string
            title?: string
            fileFormat?: string
          }
        | null
      if (!status) continue

      if (status.title) title = status.title
      if (status.fileFormat) fileFormat = status.fileFormat

      if (status.status === 'failed') throw new Error('المحرك 1: فشل تحويل الفيديو على الخدمة.')
      if (status.status === 'completed' && status.downloadUrl) {
        downloadUrl = status.downloadUrl
        break
      }
      const percent = Math.min(95, Math.max(20, Math.round(Number(status.progress) || 0)))
      ctx.onEvent({
        stage: 'convert',
        percent,
        message: status.step ? `المحرك 1: ${status.step}` : 'جاري التحويل على المحرك 1...',
        en: 'Converting on Engine 1...',
      })
    }
    if (!downloadUrl) throw new Error('المحرك 1: انتهت مهلة انتظار التحويل.')

    ctx.onEvent({ stage: 'download', percent: 5, message: 'تنزيل الملف من المحرك 1...', en: 'Downloading the file from Engine 1...' })
    const file = await streamToFile(downloadUrl, ctx, fileFormat)

    return {
      file,
      title: title || `YouTube ${ctx.videoId}`,
      quality: ctx.ext === 'mp3' ? `${chosen.quality}K` : String(chosen.quality),
    }
  },
}
