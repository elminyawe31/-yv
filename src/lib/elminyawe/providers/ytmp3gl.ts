import fs from 'node:fs'
import path from 'node:path'
import { MAX_FILE_BYTES } from '../brand'
import { compressToFit } from '../postprocess'
import { getSetting, setSetting } from '../records'
import type { ConvertContext, DownloadProvider, ProviderFile } from './types'

/* ============================================================
 *  ytmp3.gl provider — gammacloud.net private API (v1)
 *
 *  Reverse-engineered from https://ytmp3.gl/js/.../ytmp3.js:
 *    1) GET  gamma.gammacloud.net/api/v1/auth?api_key=KEY  → { geo, key }
 *    2) GET  gamma.gammacloud.net/api/v1/init              (Bearer key) → { convertURL }
 *    3) GET  convertURL&v=ID&f=mp3|mp4                     → { progressURL, downloadURL, title }
 *           (may answer redirect=1 + redirectURL — follow it once or twice)
 *    4) Poll progressURL until progress === 3              → { progress, title }
 *    5) GET  downloadURL&v=ID&f=FMT&r=REF                  → media bytes
 *
 *  Verified end-to-end from this server (MP3 + MP4, including
 *  videos where YouTube blocks yt-dlp with "Sign in to confirm
 *  you're not a bot").
 * ============================================================ */

const AUTH_ENDPOINT = 'https://gamma.gammacloud.net/api/v1/auth'
const INIT_ENDPOINT = 'https://gamma.gammacloud.net/api/v1/init'
/** Homepage embedding the CURRENT public key (rotates every few weeks —
 *  an outdated key is what produces the gateway 403). The durable store keeps
 *  the latest discovered key so every serverless instance self-heals. */
const KEY_SITE = 'https://ytmp3.gl/'
const DEFAULT_API_KEY = 'ytmp3_56d0fa62077459814d63f81ab191e8e76118d6f032edf6b23fec69e14aedb8be'
const API_KEY_PATTERN = /ytmp3_[a-f0-9]{16,}/i
const REFERER = 'https://ytmp3.gl/'
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const STEP_PERCENT = [12, 34, 66, 96] as const

/* Downloads are allowed to exceed the 80MB platform limit (ytmp3.gl ignores
 * the requested quality and always serves its default rendition) — the file
 * is then re-encoded locally by compressToFit to fit under MAX_FILE_BYTES.
 * This cap is only a safety valve against runaway responses. */
const DOWNLOAD_CAP_BYTES = 320 * 1024 * 1024

const ERROR_TEXTS: Record<string, { ar: string; en: string }> = {
  '215': { ar: 'الفيديو محجوب أو غير متاح للتحويل.', en: 'The video is blocked or unavailable for conversion.' },
  '403': { ar: 'رفضت البوابة الطلب مؤقتًا (403).', en: 'The gateway temporarily declined the request (403).' },
  '429': { ar: 'ضغط مرتفع على الخدمة — انتظر قليلًا ثم أعد المحاولة.', en: 'The service is under heavy load — please wait and retry.' },
  '502': { ar: 'خطأ داخلي في بوابة التحويل (502).', en: 'Internal conversion gateway error (502).' },
  '643': { ar: 'الفيديو طويل جدًا لهذه الخدمة.', en: 'The video is too long for this service.' },
  '644': { ar: 'تعذر فك ترميز هذا الفيديو.', en: 'This video could not be decoded.' },
  '648': { ar: 'الفيديو غير متاح في المنطقة الحالية.', en: 'The video is unavailable in the current region.' },
}

function errorText(n: number): { ar: string; en: string } {
  return ERROR_TEXTS[String(n)] || { ar: `رمز خطأ ${n}.`, en: `Error code ${n}.` }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('أُلغِيَ التحويل بعد إغلاق الطلب.')
}

interface JsonResponse {
  [key: string]: unknown
}

async function apiGet(url: string, bearer?: string, timeoutMs = 30_000): Promise<JsonResponse> {
  const headers: Record<string, string> = {
    'User-Agent': UA,
    Accept: 'application/json, text/javascript, */*; q=0.01',
    Referer: REFERER,
    Origin: REFERER.replace(/\/$/, ''),
  }
  if (bearer) headers.Authorization = `Bearer ${bearer}`
  const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`, {
    headers,
    redirect: 'follow',
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 403) {
    throw Object.assign(new Error('المحرك 2: 403 (ضغط مرتفع)'), { status: 403 } as { status: number })
  }
  if (!res.ok) throw new Error(`المحرك 2: HTTP ${res.status}`)
  const text = await res.text()
  try {
    return JSON.parse(text) as JsonResponse
  } catch {
    throw new Error('المحرك 2: استجابة غير متوقعة من البوابة.')
  }
}

function errorNumber(json: JsonResponse): number {
  const raw = json.error ?? json.err
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}

function requireString(json: JsonResponse, key: string): string {
  const v = json[key]
  return typeof v === 'string' ? v : ''
}

/** auth + init with retries + self-healing key rotation.
 *
 *  The gateway rotates its public API key every few weeks; requests made
 *  with a stale key answer 403. When that happens we scrape the CURRENT
 *  key straight from the frontend homepage, cache it in-process, persist
 *  it through the durable store (so every serverless instance adopts it)
 *  and retry immediately — no redeploy, no code change. */
let cachedApiKey: string | null = null
let lastKeyRefreshAt = 0

async function currentApiKey(): Promise<string> {
  if (process.env.YTMP3GL_API_KEY) return process.env.YTMP3GL_API_KEY
  if (cachedApiKey) return cachedApiKey
  try {
    const stored = await getSetting('ytmp3gl_key')
    if (stored && API_KEY_PATTERN.test(stored)) {
      cachedApiKey = stored
      return stored
    }
  } catch {
    /* store unavailable → built-in default */
  }
  return DEFAULT_API_KEY
}

/** Pull the live key from the ytmp3.gl homepage (throttled to 1/min). */
async function refreshApiKey(): Promise<boolean> {
  if (process.env.YTMP3GL_API_KEY) return false /* owner override — leave it */
  if (Date.now() - lastKeyRefreshAt < 60_000) return false
  lastKeyRefreshAt = Date.now()
  try {
    const res = await fetch(KEY_SITE, {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*' },
      redirect: 'follow',
      cache: 'no-store',
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) return false
    const html = await res.text()
    const fresh = html.match(API_KEY_PATTERN)?.[0]
    if (!fresh) return false
    const current = cachedApiKey || DEFAULT_API_KEY
    if (fresh === current) return false /* key is fine — the 403 is real load */
    cachedApiKey = fresh
    try {
      await setSetting('ytmp3gl_key', fresh) /* share with every instance */
    } catch {
      /* best effort — process cache still helps this instance */
    }
    return true
  } catch {
    return false
  }
}

async function openSession(): Promise<string> {
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const apiKey = await currentApiKey()
      const auth = await apiGet(`${AUTH_ENDPOINT}?api_key=${encodeURIComponent(apiKey)}`)
      const key = requireString(auth, 'key')
      if (!key) throw new Error('المحرك 2: تعذر فتح جلسة التحويل.')
      await sleep(1200)
      const init = await apiGet(INIT_ENDPOINT, key)
      const convertUrl = requireString(init, 'convertURL')
      if (!convertUrl) throw new Error('المحرك 2: تعذر تهيئة جلسة التحويل.')
      return convertUrl
    } catch (err) {
      lastErr = err
      const status = (err as { status?: number }).status
      if (status === 403) {
        /* Stale key? Scrape a fresh one and retry right away. */
        if (await refreshApiKey()) continue
        await sleep(4000 * (attempt + 1))
        continue
      }
      throw err
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('المحرك 2: تعذر فتح جلسة تحويل.')
}

/** Follow the redirect chain and return the terminal convert payload. */
async function startConvert(convertUrl: string, videoId: string, format: string): Promise<JsonResponse> {
  let url = `${convertUrl}&v=${encodeURIComponent(videoId)}&f=${format}`
  for (let hop = 0; hop < 4; hop++) {
    const json = await apiGet(url)
    const err = errorNumber(json)
    if (err !== 0) throw new Error(errorText(err).ar)
    if (Number(json.redirect) === 1) {
      const next = requireString(json, 'redirectURL')
      if (!next) throw new Error('المحرك 2: إعادة توجيه بلا رابط.')
      url = next
      await sleep(1500)
      continue
    }
    return json
  }
  throw new Error('المحرك 2: سلسلة إعادة توجيه أطول من المتوقع.')
}

/** Poll the progress endpoint until the file is ready (progress === 3). */
async function waitForFile(progressUrl: string, ctx: ConvertContext): Promise<string> {
  let lastStep = -1
  let title = ''
  for (let i = 0; i < 60; i++) {
    checkAbort(ctx.signal)
    await sleep(2800)
    const json = await apiGet(progressUrl, undefined, 20_000)
    const err = errorNumber(json)
    if (err !== 0) throw new Error(errorText(err).ar)
    const step = Number(json.progress)
    const stepTitle = requireString(json, 'title')
    if (stepTitle) title = stepTitle
    if (Number.isFinite(step) && step > lastStep) {
      lastStep = step
      if (step < 3) {
        ctx.onEvent({
          stage: 'convert',
          percent: STEP_PERCENT[Math.min(step, STEP_PERCENT.length - 1)],
          message: ['جاري فحص الفيديو...', 'جاري استخراج المسار...', 'جاري ترميز الملف...'][step] ?? 'جاري التحويل...',
          en: ['Inspecting the video...', 'Extracting the track...', 'Encoding the file...'][step] ?? 'Converting...',
        })
      }
    }
    if (step >= 3) break
  }
  return title
}

/** Stream the finished file to disk with size enforcement. */
async function streamToFile(
  downloadUrl: string,
  videoId: string,
  format: string,
  ctx: ConvertContext
): Promise<string> {
  const target = path.join(ctx.workDir, `ytmp3gl-out.${format}`)
  const res = await fetch(`${downloadUrl}&v=${encodeURIComponent(videoId)}&f=${format}&r=ytmp3.gl`, {
    headers: { 'User-Agent': UA, Referer: REFERER },
    redirect: 'follow',
    signal: ctx.signal ?? AbortSignal.timeout(240_000),
  })
  if (!res.ok || !res.body) throw new Error('المحرك 2: فشل تنزيل الملف.')

  const declared = Number(res.headers.get('content-length')) || 0
  const out = fs.createWriteStream(target)
  const reader = res.body.getReader()
  let received = 0
  let lastEmitted = -1
  /* Drain-wait that also settles when the stream is destroyed or the request
   * aborts — otherwise a backpressured download could hang forever holding
   * the single conversion slot. */
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
      if (received > DOWNLOAD_CAP_BYTES) {
        throw new Error(`تجاوز الملف الحد الأقصى (${Math.floor(DOWNLOAD_CAP_BYTES / 1048576)}MB).`)
      }
      if (!out.write(value)) {
        await waitDrain()
        if (out.destroyed) throw new Error('أُلغِيَ تنزيل الملف من المحرك 2.')
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
    throw new Error('المحرك 2: الملف المستلم فارغ أو تالف.')
  }
  return target
}

export const ytmp3glProvider: DownloadProvider = {
  id: 'ytmp3gl',
  label: 'المحرك 2',
  techLabel: 'engine2',
  kind: 'api',
  unavailableReason(): string | null {
    return null // pure HTTP API, always considered available
  },
  async convert(ctx: ConvertContext): Promise<ProviderFile> {
    checkAbort(ctx.signal)
    ctx.onEvent({ stage: 'resolve', message: 'فتح جلسة تحويل على المحرك 2...', en: 'Opening a conversion session on Engine 2...' })
    const convertUrl = await openSession()
    ctx.onEvent({ stage: 'resolve', percent: 8, message: 'إرسال الفيديو إلى بوابة التحويل...', en: 'Sending the video to the conversion gateway...' })
    await sleep(1500)

    const payload = await startConvert(convertUrl, ctx.videoId, ctx.ext)
    const progressUrl = requireString(payload, 'progressURL')
    const downloadUrl = requireString(payload, 'downloadURL')
    let title = requireString(payload, 'title')

    if (progressUrl) {
      title = (await waitForFile(progressUrl, ctx)) || title
    }
    if (!downloadUrl) throw new Error('المحرك 2: لم تتوفر بيانات تنزيل.')

    ctx.onEvent({ stage: 'download', percent: 5, message: 'تنزيل الملف من المحرك 2...', en: 'Downloading the file from Engine 2...' })
    let file = await streamToFile(downloadUrl, ctx.videoId, ctx.ext, ctx)

    /* The gateway ignores the requested quality — if the delivered rendition
     * exceeds the platform limit, re-encode locally to fit (ffmpeg). */
    let deliveredQuality = ctx.ext === 'mp3' ? '128K' : '720'
    if (fs.statSync(file).size > MAX_FILE_BYTES) {
      ctx.onEvent({ stage: 'convert', message: 'الملف أكبر من الحد — إعادة ضغط محلية ليناسب الحد...', en: 'File exceeds the limit — re-compressing locally to fit...' })
      try {
        file = await compressToFit({
          file,
          ext: ctx.ext,
          maxBytes: MAX_FILE_BYTES,
          workDir: ctx.workDir,
          signal: ctx.signal,
          deadlineAt: ctx.deadlineAt,
        })
        deliveredQuality = ctx.ext === 'mp3' ? '≤128K' : 'auto≤720'
        ctx.onEvent({ stage: 'convert', message: 'اكتملت إعادة الضغط بنجاح.', en: 'Re-compression finished successfully.' })
      } catch (err) {
        throw new Error(
          `تجاوز الملف الحد الأقصى (${Math.floor(MAX_FILE_BYTES / 1048576)}MB): ${String((err as Error).message).slice(0, 140)}`
        )
      }
    }

    return {
      file,
      title: title || `YouTube ${ctx.videoId}`,
      quality: deliveredQuality,
    }
  },
}
