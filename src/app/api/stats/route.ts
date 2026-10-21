import { NextResponse } from 'next/server'
import { enginesStatus } from '@/lib/elminyawe/providers'
import { statsAggregates, storeModeInfo } from '@/lib/elminyawe/records'

export const dynamic = 'force-dynamic'

/** Whitelabel only — internal provider identities never leave the server. */
const ENGINE_LABELS: Record<string, string> = {
  marisa: 'engine1',
  marisaenterprises: 'engine1',
  cdnframe: 'engine1',
  ytmp3gl: 'engine2',
  'ytmp3.gl': 'engine2',
  ytdlp: 'engine3',
}

/** Public aggregate stats for the hero counters + insights charts.
 *  Reads the durable store (Catbox records / SQLite / memory) so the numbers
 *  survive cold starts and are shared by every serverless instance.
 *  Edge-cached 30s (s-maxage) — repeat polls from hero + insights + admin
 *  are absorbed by the CDN instead of waking the function each time. */
const STATS_CACHE = 'public, s-maxage=30, stale-while-revalidate=120'

export async function GET() {
  try {
    const [agg, engines] = await Promise.all([statsAggregates(), enginesStatus()])
    const enginesActive = engines.filter((e) => e.available).length
    const info = storeModeInfo()

    /* Map internal provider ids to whitelabel labels, then MERGE the totals —
     * several internal ids (marisa / marisaenterprises / cdnframe) all map to
     * "engine1"; without merging, the insights list would render duplicate
     * React keys and the chart double-counts a single logical engine. */
    const engineTotals: Record<string, number> = {}
    for (const [engine, count] of Object.entries(agg.byEngine)) {
      if (typeof count !== 'number' || count <= 0) continue
      const label = ENGINE_LABELS[engine] || engine
      engineTotals[label] = (engineTotals[label] || 0) + count
    }
    const byEngine = Object.entries(engineTotals)
      .map(([engine, count]) => ({ engine, count }))
      .sort((a, b) => b.count - a.count)

    return NextResponse.json(
      {
        ok: true,
        totalConversions: agg.totalConversions,
        totalMB: agg.totalMB,
        enginesActive,
        enginesTotal: engines.length,
        store: { mode: info.mode, persistent: info.persistent },
        insights: { days: agg.days, byEngine, mp3: agg.mp3, mp4: agg.mp4 },
      },
      { headers: { 'Cache-Control': STATS_CACHE } }
    )
  } catch (err) {
    console.warn('[stats]', String((err as Error).message).slice(0, 120))
    return NextResponse.json(
      {
        ok: false,
        totalConversions: 0,
        totalMB: 0,
        enginesActive: 0,
        enginesTotal: 0,
        insights: null,
      }
    )
  }
}
