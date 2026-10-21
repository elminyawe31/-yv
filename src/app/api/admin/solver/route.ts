import { NextResponse, type NextRequest } from 'next/server'
import { adminOnlyResponse, isAdminRequest } from '@/lib/elminyawe/admin'
import { getSetting, setSetting, storeMode } from '@/lib/elminyawe/records'
import {
  DEFAULT_SOLVER_URL,
  getSolverConfig,
  invalidateSolverCache,
  normalizeSolverUrl,
} from '@/lib/elminyawe/providers/turnstile'

export const dynamic = 'force-dynamic'

const DB_OVERRIDE_KEY = 'solver_url'

interface SolverResponse {
  ok: boolean
  active: { url: string; source: 'override' | 'env' | 'default' }
  override: string | null
  envSet: boolean
  default: string
  vercel: boolean
  /** Active durable-store mode — tells the panel how long a save lasts. */
  store: 'catbox' | 'sqlite' | 'memory'
  /** True when saves survive cold starts (Catbox records / local SQLite). */
  durable: boolean
}

async function snapshot(): Promise<SolverResponse> {
  const cfg = await getSolverConfig()
  let override: string | null = null
  try {
    const v = (await getSetting(DB_OVERRIDE_KEY))?.trim()
    if (v && /^https?:\/\/.+/i.test(v)) override = v
    else if (v && v.toLowerCase() === 'off') override = 'off'
  } catch {
    /* ignore */
  }
  const env = (process.env.ELMINYAWE_SOLVER_URL || '').trim()
  const store = storeMode()
  return {
    ok: true,
    active: { url: cfg.url, source: cfg.source },
    override,
    envSet: !!env && env.toLowerCase() !== 'off' && env.toLowerCase() !== 'disabled',
    default: DEFAULT_SOLVER_URL,
    vercel: !!process.env.VERCEL,
    store,
    durable: store === 'catbox' || store === 'sqlite',
  }
}

/** GET — current solver configuration (admin only). */
export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return adminOnlyResponse()
  return NextResponse.json(await snapshot())
}

/** POST { url } — replace the runtime solver URL (admin only). */
export async function POST(req: NextRequest) {
  if (!isAdminRequest(req)) return adminOnlyResponse()

  let url = ''
  try {
    const body = (await req.json()) as { url?: unknown }
    url = typeof body?.url === 'string' ? body.url.trim() : ''
  } catch {
    /* invalid JSON */
  }

  /* Any shape is fine — normalizeSolverUrl trims slashes/whitespace; the
   * solver layer figures out the right endpoint (/solve vs root) itself. */
  url = normalizeSolverUrl(url)
  if (url && !/^https?:\/\/[^\s]+$/i.test(url)) {
    return NextResponse.json(
      { ok: false, error: 'أدخل رابطًا صالحًا يبدأ بـ http:// أو https://' },
      { status: 400 }
    )
  }
  if (url.length > 200) {
    return NextResponse.json({ ok: false, error: 'الرابط طويل جدًا.' }, { status: 400 })
  }

  const saved = await setSetting(DB_OVERRIDE_KEY, url || null)
  if (!saved) {
    return NextResponse.json(
      { ok: false, error: 'تعذّر حفظ الإعداد في المخزن الدائم.' },
      { status: 500 }
    )
  }

  invalidateSolverCache()
  return NextResponse.json(await snapshot())
}

/** DELETE — remove the runtime override, fall back to env/default. */
export async function DELETE(req: NextRequest) {
  if (!isAdminRequest(req)) return adminOnlyResponse()
  await setSetting(DB_OVERRIDE_KEY, null)
  invalidateSolverCache()
  return NextResponse.json(await snapshot())
}
