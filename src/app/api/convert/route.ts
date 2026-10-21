import { type NextRequest } from 'next/server'
import { parseYouTubeVideo } from '@/lib/elminyawe/youtube'
import { convert, reserveConversionSlot, releaseConversionSlot, validateQuality, publicError } from '@/lib/elminyawe/convert'
import { MAX_CONCURRENT } from '@/lib/elminyawe/brand'
import { clientKey, rateLimit } from '@/lib/elminyawe/rate-limit'
import { createRecord, ownerKeyFromRequest } from '@/lib/elminyawe/records'
import type { MediaExt } from '@/lib/elminyawe/brand'
import type { ConversionEvent } from '@/lib/elminyawe/convert'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

function publicBase(req: NextRequest): string {
  const env = process.env.PUBLIC_BASE_URL
  if (env) return env.replace(/\/$/, '')
  const host = req.headers.get('host') || 'localhost:3000'
  const proto = req.headers.get('x-forwarded-proto') || (host.includes('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

export async function POST(req: NextRequest) {
  /* Abuse protection only (60/hour per IP) — by the owner's design there is
   * NO storage quota and NO conversion-count limit for users; the single
   * hard limit is the 80MB per-file cap enforced inside the pipeline. */
  const limit = rateLimit(clientKey(req), 60, 3_600_000)
  if (!limit.ok) {
    return Response.json(
      { ok: false, error: 'طلبات كثيرة من نفس العنوان؛ حاول لاحقًا.', errorEn: 'Too many requests from the same address; try again later.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } }
    )
  }

  let body: { url?: string; type?: string; quality?: string; lang?: string; trim?: { start?: unknown; end?: unknown }; artist?: unknown }
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, error: 'طلب غير صالح.', errorEn: 'Invalid request.' }, { status: 400 })
  }

  const lang = body?.lang === 'en' ? 'en' : 'ar'
  const video = parseYouTubeVideo(body?.url)
  if (!video) return Response.json({ ok: false, error: 'رابط يوتيوب غير صالح.', errorEn: 'Invalid YouTube link.' }, { status: 400 })
  const ext = (body?.type || 'mp3') as MediaExt
  if (!['mp3', 'mp4'].includes(ext)) return Response.json({ ok: false, error: 'اختر MP3 أو MP4.', errorEn: 'Pick MP3 or MP4.' }, { status: 400 })
  const quality = validateQuality(ext, body?.quality)
  if (!quality) return Response.json({ ok: false, error: 'الجودة غير مدعومة.', errorEn: 'Unsupported quality.' }, { status: 400 })

  /* Optional clip window — validated then forwarded to the pipeline. */
  let trim: { start: number; end: number } | undefined
  if (body?.trim && typeof body.trim === 'object') {
    const start = Number(body.trim.start)
    const end = Number(body.trim.end)
    if (Number.isFinite(start) && Number.isFinite(end)) {
      if (start < 0 || end <= start) {
        return Response.json({ ok: false, error: 'نطاق القص غير صالح: النهاية يجب أن تكون بعد البداية.' }, { status: 400 })
      }
      if (end - start < 2) {
        return Response.json({ ok: false, error: 'أقصر مقطع مسموح هو ثانيتان.' }, { status: 400 })
      }
      if (end - start > 36_000) {
        return Response.json({ ok: false, error: 'أطول مقطع مسموح هو 10 ساعات.' }, { status: 400 })
      }
      trim = { start: Math.floor(start), end: Math.ceil(end) }
    }
  }

  /* Optional artist (channel name) for MP3 ID3 embedding. */
  const artist =
    typeof body?.artist === 'string' && body.artist.trim() && /^\p{L}[\p{L}\p{N} .,&'\-()]{0,119}$/u.test(body.artist.trim())
      ? body.artist.trim()
      : undefined

  /* ---- Owner identity for the record + files dashboard (no quota gate —
   *   unlimited storage by design; only the per-file 80MB cap applies). ---- */
  const owner = ownerKeyFromRequest(req)

  if (!reserveConversionSlot()) {
    return Response.json(
      { ok: false, error: 'الخادم مشغول؛ حاول لاحقًا.', errorEn: 'The server is busy; try again shortly.' },
      { status: 503, headers: { 'Retry-After': '30' } }
    )
  }

  const base = publicBase(req)
  const controller = new AbortController()
  const encoder = new TextEncoder()
  /* Once the client disconnects (HMR reload, tab close, cancel), stop writing
   * entirely — enqueueing into a canceled stream races Next's pipe adapter and
   * can surface as ERR_STREAM_DESTROYED in the event loop. */
  let clientGone = false

  const stream = new ReadableStream<Uint8Array>({
    async start(streamController) {
      const send = (obj: Record<string, unknown>) => {
        if (clientGone) return
        try {
          streamController.enqueue(encoder.encode(JSON.stringify(obj) + '\n'))
        } catch {
          clientGone = true
        }
      }
      const onEvent = (event: ConversionEvent) => send({ ...event })
      const disconnected = () => {
        clientGone = true
        controller.abort()
      }
      req.signal.addEventListener('abort', disconnected)
      try {
        const result = await convert({ video, ext, quality, trim, artist, baseUrl: base, signal: controller.signal, onEvent })
        /* ---- Persist the history record via the unified mode-aware store
         * (sqlite locally / Catbox records on deployments) with a read-back
         * verification retry inside createRecord — conversions must never
         * silently vanish from the log again. ---- */
        try {
          await createRecord({
            fileKey: result.fileKey,
            ext: result.type,
            storage: result.storage,
            title: result.title,
            videoId: video.id,
            thumbnail: `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`,
            quality: result.qualityRequested,
            engine: result.engine,
            sizeBytes: Math.round(result.size),
            ownerKey: owner,
          })
        } catch (dbErr) {
          const e = dbErr as Error & { cause?: Error }
          console.warn(
            '[convert] failed to persist history:',
            e?.name || 'Error',
            String(e?.message || e).slice(0, 140),
            e?.cause ? `| cause: ${String(e.cause.message || e.cause).slice(0, 100)}` : '',
          )
        }
        send({ ...result, ok: true })
      } catch (err) {
        send({ ok: false, error: publicError(err, lang), errorEn: publicError(err, 'en') })
      } finally {
        req.signal.removeEventListener('abort', disconnected)
        releaseConversionSlot()
        try {
          streamController.close()
        } catch {
          /* already closed */
        }
      }
    },
    cancel() {
      clientGone = true
      controller.abort()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  })
}

export const runtime = 'nodejs'
export const _ = { MAX_CONCURRENT }
