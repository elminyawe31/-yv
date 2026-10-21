const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com'])

export interface ParsedVideo {
  id: string
  url: string
}

/** Strict YouTube URL parser — ported from the original ELMINYAWE server.js. */
export function parseYouTubeVideo(value: unknown): ParsedVideo | null {
  if (typeof value !== 'string' || value.length > 2048) return null
  let input = value.trim()
  if (!/^https?:\/\//i.test(input)) {
    if (!/^(?:(?:www|m|music)\.)?youtube\.com\/|^youtu\.be\//i.test(input)) return null
    input = `https://${input}`
  }
  let u: URL
  try {
    u = new URL(input)
  } catch {
    return null
  }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.port) return null
  let id: string | null = null
  if (u.hostname.toLowerCase() === 'youtu.be') {
    id = u.pathname.match(/^\/([A-Za-z0-9_-]{11})\/?$/)?.[1] ?? null
  } else if (YOUTUBE_HOSTS.has(u.hostname.toLowerCase())) {
    if (u.pathname === '/watch' || u.pathname === '/watch/') {
      id = u.searchParams.get('v')
    } else {
      id = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})\/?$/)?.[1] ?? null
    }
  }
  return id && VIDEO_ID.test(id) ? { id, url: `https://www.youtube.com/watch?v=${id}` } : null
}
