import { NextResponse, type NextRequest } from 'next/server'
import { BRAND, MAX_FILE_MB, MAX_CONCURRENT, CONVERSION_DEADLINE_MS } from '@/lib/elminyawe/brand'
import { catboxReachable } from '@/lib/elminyawe/catbox'
import { getActiveConversions } from '@/lib/elminyawe/convert'
import { enginesStatus } from '@/lib/elminyawe/providers'
import { countRecords, storeHealth, storeModeInfo } from '@/lib/elminyawe/records'

export const dynamic = 'force-dynamic'

/* Edge-cached ~30s: the engine strip polls this every 90s per visitor —
 * the CDN absorbs the repeats instead of waking the function each time
 * (keeps Fast Origin Transfer and catbox reads near zero on idle polls). */
const HEALTH_HEADERS = { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' }

export async function GET(_req: NextRequest) {
  /* Probe the ACTIVE store (catbox/sqlite/memory) — never a raw Prisma call:
   * on Vercel each route boots its own instance, so the store must be
   * provisioned (or the Catbox album reached) through the store layer. */
  const [store, conversions, remoteStorage, engines] = await Promise.all([
    storeHealth(),
    countRecords().catch(() => 0),
    catboxReachable(),
    enginesStatus(),
  ])
  const info = storeModeInfo()
  return NextResponse.json(
    {
      ok: true,
      brand: BRAND,
      storage: remoteStorage ? 'remote' : 'local',
      store: { mode: info.mode, persistent: info.persistent },
      db: store.ok,
      totalConversions: conversions,
      conversionSeconds: Math.floor(CONVERSION_DEADLINE_MS / 1000),
      maxMB: MAX_FILE_MB,
      activeConversions: getActiveConversions(),
      maxConcurrent: MAX_CONCURRENT,
      /* Public endpoint: engine notes are generic — no internal details. */
      engines: engines.map((e) => ({
        id: e.id,
        label: e.label,
        techLabel: e.id,
        kind: e.kind,
        order: e.order,
        available: e.available,
        note: e.available ? undefined : e.note,
      })),
    },
    { headers: HEALTH_HEADERS }
  )
}
