import { NextResponse, type NextRequest } from 'next/server'
import { extractPlaylistId } from '@/lib/time'
import { clientKey, rateLimit } from '@/lib/elminyawe/rate-limit'

export const dynamic = 'force-dynamic'

/** Cap how many entries we return / can enqueue in one go — keeps the request fast
 *  and the batch queue honest (server converts one file at a time anyway). */
const MAX_ITEMS = 50

interface PlaylistEntry {
  id: string
  title: string
  durationString: string
  thumbnail: string
}

interface PlaylistPayload {
  ok: true
  playlistId: string
  title: string
  total: number
  returned: number
  items: PlaylistEntry[]
}

/** Walk any nested InnerTube structure collecting lockupViewModel entries. */
function collectLockups(node: unknown, out: { id: string; raw: Record<string, unknown> }[]): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const child of node) collectLockups(child, out)
    return
  }
  const obj = node as Record<string, unknown>
  const lockup = obj.lockupViewModel as Record<string, unknown> | undefined
  if (lockup && typeof lockup.contentId === 'string') {
    out.push({ id: lockup.contentId, raw: lockup })
    return
  }
  for (const value of Object.values(obj)) collectLockups(value, out)
}

/** Pull a m:ss / h:mm:ss badge text out of the thumbnail overlays. */
function badgeDuration(lockup: Record<string, unknown>): string {
  const contentImage = lockup.contentImage as Record<string, unknown> | undefined
  const thumb = contentImage?.thumbnailViewModel as Record<string, unknown> | undefined
  const overlays = (thumb?.overlays as unknown[]) || []
  for (const overlay of overlays) {
    const bottom = (overlay as Record<string, unknown>)?.thumbnailBottomOverlayViewModel as
      | Record<string, unknown>
      | undefined
    const badges = (bottom?.badges as unknown[]) || []
    for (const badge of badges) {
      const text = (badge as Record<string, unknown>)?.thumbnailBadgeViewModel as
        | Record<string, unknown>
        | undefined
      const t = text?.text
      if (typeof t === 'string' && /^\d+(?::\d{1,2})+$/.test(t)) return t
    }
  }
  return ''
}

function plainTitle(lockup: Record<string, unknown>): string {
  const metadata = lockup.metadata as Record<string, unknown> | undefined
  const meta = metadata?.lockupMetadataViewModel as Record<string, unknown> | undefined
  const title = meta?.title as Record<string, unknown> | undefined
  const content = title?.content
  return typeof content === 'string' ? content : ''
}

function bestThumbnail(lockup: Record<string, unknown>): string {
  const contentImage = lockup.contentImage as Record<string, unknown> | undefined
  const thumb = contentImage?.thumbnailViewModel as Record<string, unknown> | undefined
  const image = thumb?.image as Record<string, unknown> | undefined
  const sources = (image?.sources as { url?: string }[]) || []
  for (const s of sources) {
    if (s.url && !s.url.includes('sqp=')) return s.url
  }
  return sources.at(-1)?.url || ''
}

async function browsePlaylist(playlistId: string): Promise<PlaylistPayload | null> {
  const res = await fetch('https://www.youtube.com/youtubei/v1/browse', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    body: JSON.stringify({
      context: { client: { clientName: 'WEB', clientVersion: '2.20240101.00.00', hl: 'en' } },
      browseId: `VL${playlistId}`,
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) return null
  const data = (await res.json()) as Record<string, unknown>

  const lockups: { id: string; raw: Record<string, unknown> }[] = []
  collectLockups(data.contents, lockups)

  const seen = new Set<string>()
  const items: PlaylistEntry[] = []
  for (const { id, raw } of lockups) {
    if (seen.has(id) || !/^[\w-]{11}$/.test(id)) continue
    seen.add(id)
    items.push({
      id,
      title: plainTitle(raw) || `Video ${id}`,
      durationString: badgeDuration(raw),
      thumbnail: bestThumbnail(raw) || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    })
    if (items.length >= MAX_ITEMS) break
  }
  if (!items.length) return null

  // Playlist title — newer pages use pageHeaderRenderer, older use playlistHeaderRenderer.
  let title = ''
  const header = data.header as Record<string, unknown> | undefined
  const pageHeader = header?.pageHeaderRenderer as Record<string, unknown> | undefined
  if (pageHeader) {
    title = (pageHeader.pageTitle as string) || ''
  }
  const sidebar = data.sidebar as Record<string, unknown> | undefined
  const playlistSidebar = sidebar?.playlistSidebarRenderer as Record<string, unknown> | undefined
  const primary = (playlistSidebar?.items as unknown[] | undefined)?.[0] as
    | Record<string, unknown>
    | undefined
  const primaryInfo = primary?.playlistSidebarPrimaryInfoRenderer as Record<string, unknown> | undefined
  const titleRuns = primaryInfo?.title as { runs?: { text?: string }[] } | undefined
  if (!title && titleRuns?.runs?.[0]?.text) title = titleRuns.runs[0].text
  if (!title && data.title) title = String(data.title)

  return {
    ok: true,
    playlistId,
    title: title || 'قائمة تشغيل',
    total: items.length,
    returned: items.length,
    items,
  }
}

export async function POST(req: NextRequest) {
  const limit = rateLimit(clientKey(req), 10, 5 * 60_000)
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: 'طلبات كثيرة؛ حاول بعد قليل.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } }
    )
  }

  let body: { url?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'طلب غير صالح.' }, { status: 400 })
  }

  const playlistId = extractPlaylistId(body?.url || '')
  if (!playlistId || !/^[\w-]{12,64}$/.test(playlistId)) {
    return NextResponse.json({ ok: false, error: 'رابط قائمة تشغيل يوتيوب غير صالح.' }, { status: 400 })
  }

  try {
    const payload = await browsePlaylist(playlistId)
    if (!payload) {
      return NextResponse.json(
        { ok: false, error: 'تعذّر جلب محتوى القائمة — قد تكون خاصة أو محذوفة.' },
        { status: 502 }
      )
    }
    return NextResponse.json(payload)
  } catch (err) {
    console.warn('[playlist]', String((err as Error).message).slice(0, 140))
    return NextResponse.json({ ok: false, error: 'تعذّر الوصول إلى يوتيوب الآن.' }, { status: 502 })
  }
}
