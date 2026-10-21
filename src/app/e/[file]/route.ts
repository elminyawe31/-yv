import fs from 'node:fs'
import { type NextRequest } from 'next/server'
import { resolveBrandedFile, localFileStream } from '@/lib/elminyawe/storage'
import { BRAND, MAX_FILE_BYTES } from '@/lib/elminyawe/brand'
import { clientKey, rateLimit } from '@/lib/elminyawe/rate-limit'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/* ============================================================
 *  /e/:file — the branded public media link (v3.5)
 *
 *  BANDWIDTH ARCHITECTURE (why this route redirects):
 *  Vercel's "Fast Origin Transfer" quota (10 GB/month on Hobby)
 *  counts EVERY byte a serverless function streams back through
 *  the CDN. Proxying media bytes here previously burned tens of
 *  GB per month (players re-fetch ranges, embeds, reshares…).
 *
 *  Now:
 *   • Catbox-hosted files → HTTP 307 straight to the storage URL.
 *     The bytes never touch Vercel Compute — bandwidth ≈ 0, and
 *     the CDN caches the tiny redirect itself (s-maxage=1d).
 *   • ?download=1 → still proxied ONCE per explicit user click,
 *     so the browser gets a branded attachment filename. Set
 *     ELMINYAWE_DIRECT_DOWNLOADS=1 to redirect these too (zero
 *     compute bandwidth, filename falls back to the storage key).
 *   • ?proxy=1 → force the byte-proxy (escape hatch for visitors whose
 *     ISP DNS-blocks catbox — see the Connectivity section of the FAQ).
 *   • Local/mirrored files (dev) → streamed from disk as before.
 *   • v5.4: media files live ONLY on Catbox (no Blob file objects),
 *     and catbox keys resolve statelessly — files.catbox.moe/{key}.{ext}
 *     keeps working without any database lookup.
 * ============================================================ */

function directDownloadsEnabled(): boolean {
  return (process.env.ELMINYAWE_DIRECT_DOWNLOADS || '').trim() === '1'
}

function setCommonHeaders(resHeaders: Headers, ext: string, download: boolean, filename: string) {
  resHeaders.set('Content-Type', ext === 'mp3' ? 'audio/mpeg' : 'video/mp4')
  resHeaders.set('Accept-Ranges', 'bytes')
  resHeaders.set(
    'Content-Disposition',
    `${download ? 'attachment' : 'inline'}; filename="${filename}"`
  )
}

/** 307 → storage URL. The redirect is tiny and CDN-cacheable. */
function redirectTo(url: string): Response {
  return new Response(null, {
    status: 307,
    headers: {
      Location: url,
      // Edge-cached for a day, browsers may keep it 10 minutes.
      'Cache-Control': 'public, max-age=600, s-maxage=86400, stale-while-revalidate=604800',
    },
  })
}

function parseRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return null
  const m = header.match(/^bytes=(\d+)-(\d*)$/)
  if (!m) return null
  const start = parseInt(m[1], 10)
  const end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1
  if (start > end || start >= size) return null
  return { start, end }
}

async function handle(req: NextRequest, fileParam: string) {
  const limit = rateLimit(clientKey(req), 600, 10 * 60_000)
  if (!limit.ok) {
    return new Response('طلبات كثيرة؛ حاول لاحقًا.', {
      status: 429,
      headers: { 'Retry-After': String(limit.retryAfterSec) },
    })
  }

  const file = resolveBrandedFile(fileParam)
  if (!file) {
    /* v5.3 — tell the visitor WHY an L-key link died: it predates the
     * durable-storage fix and lived only on the old ephemeral disk. */
    const expired = new RegExp(`^${BRAND}-L[A-Za-z0-9_-]{4,}\\.(mp3|mp4)$`).test(fileParam)
    return new Response(
      expired
        ? `${BRAND} — انتهت صلاحية هذا الملف (حُفظ مؤقتًا قبل تحديث الحفظ الدائم للتخزين). أعد التحويل وسيعمل رابطك الجديد بلا انتهاء.`
        : `${BRAND} — الرابط غير موجود`,
      { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }
    )
  }

  const download = req.nextUrl.searchParams.get('download') === '1'
  const forceProxy = req.nextUrl.searchParams.get('proxy') === '1'
  const brandedName = `${BRAND}.${file.ext}`
  const resHeaders = new Headers()
  setCommonHeaders(resHeaders, file.ext, download, brandedName)

  // ---------- Local storage (or local mirror of a catbox upload) ----------
  if (file.storage === 'local' || file.localPath) {
    const stat = fs.statSync(file.localPath || file.url)
    const total = stat.size
    if (total > MAX_FILE_BYTES) return new Response('Media exceeds size limit', { status: 413 })
    const rangeHeader = req.headers.get('range')
    if (rangeHeader && (rangeHeader.length > 120 || !/^bytes=(?:\d+-\d*|-\d+)$/.test(rangeHeader))) {
      return new Response(null, { status: 416 })
    }
    let range = parseRange(rangeHeader, total)
    if (rangeHeader && !range) {
      resHeaders.set('Content-Range', `bytes */${total}`)
      return new Response(null, { status: 416, headers: resHeaders })
    }
    if (req.method === 'HEAD') {
      resHeaders.set('Content-Length', String(total))
      return new Response(null, { status: 200, headers: resHeaders })
    }
    if (range) {
      resHeaders.set('Content-Range', `bytes ${range.start}-${range.end}/${total}`)
      resHeaders.set('Content-Length', String(range.end - range.start + 1))
      return new Response(localFileStream(file.localPath || file.url, range), { status: 206, headers: resHeaders })
    }
    resHeaders.set('Content-Length', String(total))
    return new Response(localFileStream(file.localPath || file.url), { status: 200, headers: resHeaders })
  }

  // ---------- Catbox: redirect by default (bandwidth ≈ 0) ----------
  // Players, embeds, <img>/preview opens and reshares all follow the 307
  // straight to storage — none of those bytes touch Vercel Compute.
  if (file.storage === 'catbox' && file.url) {
    if (!forceProxy && !(download && !directDownloadsEnabled())) {
      return redirectTo(download ? `${file.url}${file.url.includes('?') ? '&' : '?'}download=1` : file.url)
    }
  }

  // ---------- Byte-proxy (explicit download clicks or ?proxy=1) ----------
  const proxyUrl = file.url
  if (!proxyUrl) return new Response('Storage unavailable', { status: 502 })

  const rangeHeader = req.headers.get('range')
  if (rangeHeader && (rangeHeader.length > 120 || !/^bytes=(?:\d+-\d*|-\d+)$/.test(rangeHeader))) {
    return new Response(null, { status: 416 })
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60_000)
  req.signal.addEventListener('abort', () => controller.abort(), { once: true })
  const fetchOnce = () =>
    fetch(proxyUrl, {
      method: 'GET',
      cache: 'no-store',
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: '*/*', ...(rangeHeader ? { Range: rangeHeader } : {}) },
      redirect: 'error',
      signal: controller.signal,
    })
  try {
    let up = await fetchOnce()
    // One retry on network-level/5xx failures — catbox reads can be flaky.
    if (up.status >= 500 || up.status === 429) {
      await up.body?.cancel().catch(() => {})
      await new Promise((r) => setTimeout(r, 900))
      up = await fetchOnce()
    }
    if (up.status === 416) {
      const value = up.headers.get('content-range')
      if (value) resHeaders.set('Content-Range', value)
      await up.body?.cancel().catch(() => {})
      return new Response(null, { status: 416, headers: resHeaders })
    }
    if (!up.ok) {
      await up.body?.cancel().catch(() => {})
      return new Response('Storage unavailable', { status: up.status === 404 ? 404 : 502 })
    }
    const contentType = up.headers.get('content-type') || ''
    if (/^(?:text\/html|text\/plain|application\/json)/i.test(contentType)) {
      await up.body?.cancel().catch(() => {})
      return new Response('Storage returned a page, not media', { status: 502 })
    }
    const contentRange = up.headers.get('content-range') || ''
    const rangeTotal = contentRange.match(/\/(\d+)$/)?.[1] || null
    const total = Number(rangeTotal || up.headers.get('content-length'))
    if (Number.isFinite(total) && total > MAX_FILE_BYTES) {
      await up.body?.cancel().catch(() => {})
      return new Response('Media exceeds size limit', { status: 413 })
    }
    for (const header of ['cache-control', 'etag', 'last-modified']) {
      const value = up.headers.get(header)
      if (value) resHeaders.set(header, value)
    }
    if (req.method === 'HEAD') {
      await up.body?.cancel().catch(() => {})
      if (up.status === 206 && rangeTotal) resHeaders.set('Content-Length', rangeTotal)
      else {
        const cl = up.headers.get('content-length')
        if (cl) resHeaders.set('Content-Length', cl)
      }
      return new Response(null, { status: 200, headers: resHeaders })
    }
    if (up.status === 206) {
      const cr = up.headers.get('content-range')
      if (cr) resHeaders.set('Content-Range', cr)
    }
    const cl = up.headers.get('content-length')
    if (cl) resHeaders.set('Content-Length', cl)
    if (!up.body) return new Response(null, { status: 502, headers: resHeaders })
    return new Response(up.body, { status: up.status, headers: resHeaders })
  } catch (err) {
    // Network error — retry once before giving up (mirror-less legacy files).
    try {
      const up = await fetchOnce()
      if (up.ok) {
        const cl0 = up.headers.get('content-length')
        if (req.method === 'HEAD') {
          await up.body?.cancel().catch(() => {})
          if (cl0) resHeaders.set('Content-Length', cl0)
          return new Response(null, { status: 200, headers: resHeaders })
        }
        if (!up.body) {
          /* no body to stream — fall through to the error below */
        } else {
          if (cl0) resHeaders.set('Content-Length', cl0)
          return new Response(up.body, { status: up.status, headers: resHeaders })
        }
      } else {
        await up.body?.cancel().catch(() => {})
      }
    } catch {
      /* second attempt failed too — fall through */
    }
    const e = err as Error & { cause?: Error }
    console.warn('[playback]', String(e.message || e), '| cause:', String(e.cause?.message || ''), '| key:', file.id)
    return new Response('Media unavailable', { status: 502 })
  } finally {
    clearTimeout(timer)
  }
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params
  return handle(req, file)
}

export async function HEAD(req: NextRequest, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params
  return handle(req, file)
}
