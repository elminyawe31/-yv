import { NextResponse, type NextRequest } from 'next/server'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseYouTubeVideo } from '@/lib/elminyawe/youtube'
import { run } from '@/lib/elminyawe/runner'
import { resolveYtdlp, formatDuration, BRAND } from '@/lib/elminyawe/brand'
import { providerVideoInfo } from '@/lib/elminyawe/providers'
import { clientKey, rateLimit } from '@/lib/elminyawe/rate-limit'

export const dynamic = 'force-dynamic'

/** GET variant (url query param) so health monitors and share previews can
 *  probe metadata without a POST body — previously answered 405. */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url') || ''
  return handleInfo(req, url)
}

export async function POST(req: NextRequest) {
  let body: { url?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'طلب غير صالح.', errorEn: 'Invalid request.' }, { status: 400 })
  }
  return handleInfo(req, body?.url || '')
}

async function handleInfo(req: NextRequest, rawUrl: string) {
  const limit = rateLimit(clientKey(req), 30, 60_000)
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: 'طلبات كثيرة من نفس العنوان؛ حاول لاحقًا.', errorEn: 'Too many requests; try again later.' },
      { status: 429, headers: { 'Retry-After': String(limit.retryAfterSec) } }
    )
  }

  const video = parseYouTubeVideo(rawUrl)
  if (!video) return NextResponse.json({ ok: false, error: 'رابط يوتيوب غير صالح.', errorEn: 'Invalid YouTube link.' }, { status: 400 })

  const thumbnail = `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`

  /* ---- 1) cdnframe (marisaenterprises engine): fast JSON metadata that
         keeps working even when YouTube challenges yt-dlp with a bot
         check. Enriched with the channel name via oEmbed. ---- */
  const apiInfo = await providerVideoInfo(video.id)
  if (apiInfo && apiInfo.title) {
    let channel = '—'
    try {
      const upstream = await fetch(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(video.url)}&format=json`,
        { signal: AbortSignal.timeout(10_000) }
      )
      if (upstream.ok) {
        const o = (await upstream.json()) as { author_name?: string }
        if (o.author_name) channel = o.author_name
      }
    } catch {
      /* channel is optional here */
    }
    return NextResponse.json({
      ok: true,
      source: 'engine1',
      info: {
        id: video.id,
        title: apiInfo.title,
        channel,
        channelAvatar: null,
        duration: apiInfo.duration || 0,
        durationString: formatDuration(apiInfo.duration),
        description: 'معلومات مختصرة من محرك التحويل الخارجي.',
        thumbnail,
        webpageUrl: video.url,
        tooLong: (apiInfo.duration || 0) > 5400,
      },
    })
  }

  /* ---- 2) yt-dlp: richest metadata when YouTube cooperates ---- */
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elminyawe-info-'))
  try {
    const { stdout } = await run(
      resolveYtdlp(),
      [
        '--ignore-config',
        '--no-cache-dir',
        '--no-playlist',
        '--dump-single-json',
        '--skip-download',
        '--no-warnings',
        '--socket-timeout',
        '15',
        video.url,
      ],
      { timeout: 45_000, dir }
    )
    const j = JSON.parse(stdout)
    return NextResponse.json({
      ok: true,
      info: {
        id: video.id,
        title: j.title || BRAND,
        channel: j.channel || j.uploader || '—',
        channelAvatar: null,
        duration: j.duration || 0,
        durationString: formatDuration(j.duration),
        description: (j.description || '').slice(0, 500),
        thumbnail: j.thumbnail || thumbnail,
        webpageUrl: video.url,
        tooLong: (j.duration || 0) > 5400,
      },
    })
  } catch (error) {
    console.warn('[info] yt-dlp failed:', String((error as Error).message).slice(0, 120))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }

  /* ---- 3) oEmbed: last resort ---- */
  try {
    const upstream = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(video.url)}&format=json`,
      { signal: AbortSignal.timeout(12_000) }
    )
    if (upstream.ok) {
      const o = await upstream.json()
      return NextResponse.json({
        ok: true,
        fallback: true,
        info: {
          id: video.id,
          title: o.title || BRAND,
          channel: o.author_name || '—',
          channelAvatar: null,
          duration: 0,
          durationString: '—',
          description: 'معلومات مختصرة؛ تعذر استخراج مدة الفيديو.',
          thumbnail,
          webpageUrl: video.url,
          tooLong: false,
        },
      })
    }
  } catch {
    /* no metadata provider */
  }
  return NextResponse.json(
    { ok: false, error: 'تعذّر التعرف على الفيديو من الخادم.', errorEn: 'The video could not be identified.' },
    { status: 502 }
  )
}
