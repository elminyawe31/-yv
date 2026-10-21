import { NextResponse, type NextRequest } from 'next/server'
import { clientKey, rateLimit } from '@/lib/elminyawe/rate-limit'
import { BRAND } from '@/lib/elminyawe/brand'

export const dynamic = 'force-dynamic'

const VIDEO_ID_RE = /^[\w-]{11}$/
const MAX_COVER_BYTES = 5 * 1024 * 1024 // 5MB safety cap

/**
 * YouTube cover-art downloader with an attachment disposition.
 * GET /api/cover?videoId=<11-char id>&quality=maxres|hq|mq
 *
 * The browser cannot force-download cross-origin ytimg URLs directly
 * (no CORS headers + the download attribute is ignored cross-origin),
 * so we proxy the bytes through our origin after strict validation.
 */
export async function GET(req: NextRequest) {
  const limit = rateLimit(clientKey(req), 30, 5 * 60_000)
  if (!limit.ok) {
    return NextResponse.json({ ok: false, error: 'طلبات كثيرة؛ حاول لاحقًا.' }, { status: 429 })
  }

  const videoId = req.nextUrl.searchParams.get('videoId') || ''
  const quality = req.nextUrl.searchParams.get('quality') || 'maxres'

  if (!VIDEO_ID_RE.test(videoId)) {
    return NextResponse.json({ ok: false, error: 'معرّف فيديو غير صالح.' }, { status: 400 })
  }

  const qualities = quality === 'hq' ? ['hqdefault'] : quality === 'mq' ? ['mqdefault'] : ['maxresdefault', 'hqdefault']

  for (const q of qualities) {
    try {
      const res = await fetch(`https://i.ytimg.com/vi/${videoId}/${q}.jpg`, {
        signal: AbortSignal.timeout(10_000),
        // Bypass any router-side fetch caching of remote bytes.
        cache: 'no-store',
      })
      if (!res.ok) continue
      const buf = Buffer.from(await res.arrayBuffer())
      // YouTube serves a grey 120x90 placeholder for missing thumbs.
      if (buf.length < 2048) continue
      if (buf.length > MAX_COVER_BYTES) continue

      return new NextResponse(new Uint8Array(buf), {
        status: 200,
        headers: {
          'Content-Type': res.headers.get('content-type') || 'image/jpeg',
          'Content-Length': String(buf.length),
          'Cache-Control': 'public, max-age=86400, immutable',
          'Content-Disposition': `attachment; filename="${BRAND}-cover-${videoId}.jpg"`,
        },
      })
    } catch {
      /* try the next quality */
    }
  }

  return NextResponse.json({ ok: false, error: 'تعذّر جلب صورة الغلاف.' }, { status: 404 })
}
