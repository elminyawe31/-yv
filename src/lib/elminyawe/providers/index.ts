import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ytmp3glProvider } from './ytmp3gl'
import { cdnframeProvider, cdnframeInfo } from './cdnframe'
import { getSolverInfo } from './turnstile'
import type { DownloadProvider, EngineId, VideoInfoResult } from './types'

/* ============================================================
 *  Provider registry + failover chain
 *
 *  Owner's production order (2026-10):
 *    1. marisa (cdnframe + Turnstile solver) — «المحرك 1»:
 *       the protection-bypass engine powered by the owner's
 *       ELMINYAWE Solver service. Selectable qualities.
 *    2. ytmp3gl (gammacloud) — «المحرك 2»: fast backup API engine.
 *
 *  yt-dlp is intentionally NOT part of the download chain — it does
 *  not exist on Vercel serverless. It remains available for metadata
 *  fetching only (/api/info), which is its sole purpose now.
 * ============================================================ */

const ALL: DownloadProvider[] = [cdnframeProvider, ytmp3glProvider]

function parseOrder(): EngineId[] {
  const raw = process.env.PROVIDER_ORDER || 'marisa,ytmp3gl'
  const ids = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean) as EngineId[]
  const known = ALL.map((p) => p.id)
  const valid = ids.filter((id) => known.includes(id))
  for (const id of known) if (!valid.includes(id)) valid.push(id)
  return valid
}

/** Engine 1 (marisa/cdnframe) needs the Turnstile solver configured; the
 *  chain skips it in microseconds when the solver is absent. Engine 2
 *  (ytmp3gl) is a pure HTTP API and is always considered available. */
export function providerChain(): DownloadProvider[] {
  const order = parseOrder()
  return order
    .map((id) => ALL.find((p) => p.id === id)!)
    .filter(Boolean)
}

export function getProvider(id: EngineId): DownloadProvider | undefined {
  return ALL.find((p) => p.id === id)
}

export interface EngineStatus {
  id: EngineId
  label: string
  techLabel: string
  kind: 'api' | 'local'
  order: number
  available: boolean
  note?: string
}

/** Live engine status snapshot (for /api/health and the UI). */
export async function enginesStatus(): Promise<EngineStatus[]> {
  const chain = providerChain()
  return Promise.all(
    chain.map(async (provider, index) => {
      try {
        const reason = await provider.unavailableReason()
        return {
          id: provider.id,
          label: provider.label,
          techLabel: provider.techLabel,
          kind: provider.kind,
          order: index + 1,
          available: reason === null,
          note: reason ?? undefined,
        }
      } catch (err) {
        return {
          id: provider.id,
          label: provider.label,
          techLabel: provider.techLabel,
          kind: provider.kind,
          order: index + 1,
          available: false,
          note: String((err as Error).message || err).slice(0, 160),
        }
      }
    })
  )
}

/* ---------------- metadata helpers ---------------- */

/** Fetch video metadata via cdnframe (works even when yt-dlp is bot-blocked). */
export async function providerVideoInfo(videoId: string): Promise<VideoInfoResult | null> {
  return cdnframeInfo(videoId)
}

export { getSolverInfo }
export type { DownloadProvider, EngineId }

/* ---------------- scratch directories ---------------- */

export function makeWorkDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'elminyawe-work-'))
}

export function cleanupWorkDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
}
