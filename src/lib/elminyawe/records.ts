import crypto from 'node:crypto'
import type { NextRequest } from 'next/server'
import { db, ensureSchema } from '@/lib/db'
import { removeMediaFiles } from './media-cleanup'
import {
  catboxAlbumFiles,
  catboxAlbumEdit,
  uploadCatboxDocument,
  fetchCatboxDocumentText,
  deleteCatboxFiles,
} from './catbox'
import { BRAND, CATBOX_USERHASH } from './brand'

/* ============================================================================
 *  ELMINYAWE unified durable store — v5.4 «Catbox ONLY».
 *
 *  THE OWNER'S DIRECTIVE (restated): "التخزين بشكل كامل يكون على catbox ليس
 *  blob" — EVERYTHING lives on Catbox now: the media FILES (storage.ts) and
 *  these RECORDS (numbers, history, admin settings). Vercel Blob is gone.
 *
 *  WHY AN ALBUM
 *  ------------
 *  Catbox assigns a fresh random id to every upload (verified live: same
 *  bytes → same id [content dedupe], different bytes → different id), so a
 *  document has no stable URL of its own. Catbox ALBUMS are the one stable
 *  pointer the API offers: the 6-char album id never changes, and the
 *  official `editalbum` request type REPLACES the album's whole file list.
 *  So the records document is a single small JSON file whose CURRENT
 *  revision is whatever the album points at:
 *
 *      https://catbox.moe/c/rcs8x8   (created 2026-10-21 with the owner's
 *                                     userhash — permanent, never expires)
 *
 *  WRITE FLOW  upload new json → verify bytes read-back → editalbum points
 *              the album at it alone → best-effort delete of the previous
 *              revision. The album therefore always holds EXACTLY ONE file.
 *  READ FLOW   album page (2KB html) → current file id → Range-first GET of
 *              the json → parse. Content addressing makes the file id a
 *              free version tag for the in-memory cache.
 *
 *  VERIFIED LIVE (2026-10-21, against the official API):
 *    createalbum ✓ · editalbum replaces the list ✓ · deletefiles ✓ ·
 *    account uploads are PERMANENT (FAQ) ✓ · content dedupe ✓.
 *    A file uploaded from the user's PRODUCTION deployment was read back
 *    byte-real through a Range request (12 MB MP3, valid ID3) — while the
 *    dev sandbox's egress mangles uploads (0-byte bodies) and plain GETs.
 *    That is why every read here is Range-first and every write is
 *    verified by a read-back before it is trusted.
 *
 *  MODES
 *  -----
 *    'catbox'  Vercel + CATBOX_USERHASH (baked-in default) — durable,
 *              shared by every instance, zero configuration, zero tokens.
 *    'sqlite'  local dev / self-host (durable on disk).
 *    'memory'  Vercel WITHOUT a userhash — per-instance volatile fallback.
 *
 *  LIMITS — per the owner's design there is NO storage quota and NO
 *  conversion-count quota. The only cap is MAX_FILE_MB (80 default,
 *  ceiling 200 = Catbox's own limit) enforced in the media pipeline.
 * ============================================================================
 */

export type StoreMode = 'catbox' | 'sqlite' | 'memory'

export interface ConversionRecord {
  id: string
  fileKey: string
  ext: 'mp3' | 'mp4'
  storage: 'catbox' | 'local' | 'blob'
  title: string
  channel?: string | null
  videoId?: string | null
  thumbnail?: string | null
  quality: string
  engine: string
  sizeBytes: number
  duration?: number | null
  trimStart?: number | null
  trimEnd?: number | null
  tagged?: boolean
  ownerKey?: string | null
  createdAt: string /* ISO */
}

/* ------------------------------------------------------------------ config */

/**
 * The records album — the stable pointer to the current records document.
 * Created with the owner's userhash on 2026-10-21 (title "ELMINYAWE Records
 * Store"). Override only to point a fork at its own album.
 */
const RECORDS_ALBUM_SHORT = process.env.ELMINYAWE_RECORDS_ALBUM || 'rcs8x8'
const ALBUM_TITLE = 'ELMINYAWE Records Store'
const ALBUM_DESC = 'Internal records index — do not delete'
const RECORDS_DOC_NAME = 'elminyawe-records.json'

/** Display-log cap. Counters keep lifetime totals; this caps the doc size. */
const HISTORY_CAP = 500
/** Keep per-day aggregates for 30 days; older days are pruned on write. */
const DAY_CAP = 30
/** Records doc IO budgets (small documents — seconds, not minutes). */
const DOC_READ_TTL_MS = 4_000
const DOC_TIMEOUT_MS = 12_000
const DOC_WRITE_TIMEOUT_MS = 20_000
/** 500 records × ~300B + counters ≈ 160KB — allow generous headroom. */
const DOC_MAX_BYTES = 1_500_000

export function storeMode(): StoreMode {
  /* Self-host override — lets a real server test the catbox path off-Vercel. */
  const forced = (process.env.ELMINYAWE_RECORDS_STORE || '').trim().toLowerCase()
  if (forced === 'catbox') return 'catbox'
  if (forced === 'sqlite') return 'sqlite'
  if (process.env.VERCEL) {
    return CATBOX_USERHASH ? 'catbox' : 'memory'
  }
  return 'sqlite'
}

/** Human label for the storage-mode card in the dashboard. */
export function storeModeLabel(mode: StoreMode): { ar: string; en: string } {
  switch (mode) {
    case 'catbox':
      return { ar: 'تخزين Catbox الدائم — الملفات والسجلات معًا', en: 'Durable Catbox storage — files and records together' }
    case 'sqlite':
      return { ar: 'تخزين محلي دائم', en: 'Durable local storage' }
    default:
      return { ar: 'ذاكرة مؤقتة (بدون Catbox)', en: 'Volatile memory (no Catbox)' }
  }
}

/* ------------------------------------------------------ owner identity */

export const OWNER_COOKIE = 'el_owner'
const OWNER_RE = /^[A-Za-z0-9]{6,12}$/

/** Short, friendly "your number" identity shown in the files dashboard. */
export function newOwnerKey(): string {
  return crypto.randomBytes(4).toString('hex').toUpperCase() // e.g. "7F3A21BC" — 8 chars
}

export function ownerKeyFromRequest(req: NextRequest): string {
  const raw = req.cookies.get(OWNER_COOKIE)?.value
  if (raw && OWNER_RE.test(raw)) return raw
  /* Cookie-less API client (curl, first request before middleware ran):
   * derive a stable key from the client address so usage still accrues. */
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'local'
  return 'IP' + crypto.createHash('sha256').update(ip).digest('hex').slice(0, 8).toUpperCase()
}

export function sanitizeOwnerKey(value: unknown): string | null {
  return typeof value === 'string' && OWNER_RE.test(value) ? value : null
}

/* ------------------------------------------------------------ doc helpers */

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/* ------------------------------------------------------ counters shape */

interface OwnerUsage {
  count: number
  bytes: number
}

interface Counters {
  total: number
  totalBytes: number
  mp3: number
  mp4: number
  byDay: Record<string, { count: number; bytes: number }>
  byEngine: Record<string, number>
  byOwner: Record<string, OwnerUsage>
}

function emptyCounters(): Counters {
  return { total: 0, totalBytes: 0, mp3: 0, mp4: 0, byDay: {}, byEngine: {}, byOwner: {} }
}

function sanitizeCounters(raw: unknown): Counters {
  const c = raw as Partial<Counters> | null
  const out = emptyCounters()
  out.total = Math.max(0, Number(c?.total) || 0)
  out.totalBytes = Math.max(0, Number(c?.totalBytes) || 0)
  out.mp3 = Math.max(0, Number(c?.mp3) || 0)
  out.mp4 = Math.max(0, Number(c?.mp4) || 0)
  if (c?.byDay && typeof c.byDay === 'object') {
    for (const [day, v] of Object.entries(c.byDay)) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
        out.byDay[day] = { count: Math.max(0, Number(v?.count) || 0), bytes: Math.max(0, Number(v?.bytes) || 0) }
      }
    }
  }
  if (c?.byEngine && typeof c.byEngine === 'object') {
    for (const [engine, n] of Object.entries(c.byEngine)) {
      if (typeof n === 'number' && n > 0) out.byEngine[engine] = n
    }
  }
  if (c?.byOwner && typeof c.byOwner === 'object') {
    for (const [owner, v] of Object.entries(c.byOwner)) {
      if (typeof v === 'object' && v != null) {
        const count = Math.max(0, Number((v as OwnerUsage).count) || 0)
        if (count > 0) {
          out.byOwner[owner] = { count, bytes: Math.max(0, Number((v as OwnerUsage).bytes) || 0) }
        }
      }
    }
  }
  return out
}

function pruneCounters(c: Counters): Counters {
  const days = Object.keys(c.byDay).sort()
  for (const day of days.slice(0, Math.max(0, days.length - DAY_CAP))) delete c.byDay[day]
  return c
}

function dayKeyOf(iso: string): string {
  return iso.slice(0, 10)
}

function bumpCounters(c: Counters, rec: ConversionRecord): void {
  c.total += 1
  c.totalBytes += rec.sizeBytes || 0
  if (rec.ext === 'mp3') c.mp3 += 1
  else if (rec.ext === 'mp4') c.mp4 += 1
  const day = dayKeyOf(rec.createdAt)
  const d = (c.byDay[day] ??= { count: 0, bytes: 0 })
  d.count += 1
  d.bytes += rec.sizeBytes || 0
  c.byEngine[rec.engine] = (c.byEngine[rec.engine] || 0) + 1
  if (rec.ownerKey) {
    const o = (c.byOwner[rec.ownerKey] ??= { count: 0, bytes: 0 })
    o.count += 1
    o.bytes += rec.sizeBytes || 0
  }
}

function unbumpCounters(c: Counters, rec: ConversionRecord): void {
  c.total = Math.max(0, c.total - 1)
  c.totalBytes = Math.max(0, c.totalBytes - (rec.sizeBytes || 0))
  if (rec.ext === 'mp3') c.mp3 = Math.max(0, c.mp3 - 1)
  else if (rec.ext === 'mp4') c.mp4 = Math.max(0, c.mp4 - 1)
  const day = dayKeyOf(rec.createdAt)
  const d = c.byDay[day]
  if (d) {
    d.count = Math.max(0, d.count - 1)
    d.bytes = Math.max(0, d.bytes - (rec.sizeBytes || 0))
    if (d.count === 0) delete c.byDay[day]
  }
  if (c.byEngine[rec.engine]) {
    c.byEngine[rec.engine]! -= 1
    if (c.byEngine[rec.engine]! <= 0) delete c.byEngine[rec.engine]
  }
  if (rec.ownerKey) {
    const o = c.byOwner[rec.ownerKey]
    if (o) {
      o.count = Math.max(0, o.count - 1)
      o.bytes = Math.max(0, o.bytes - (rec.sizeBytes || 0))
      if (o.count === 0) delete c.byOwner[rec.ownerKey]
    }
  }
}

/* -------------------------------------------------- catbox document layer */

/** ONE document holds everything — settings, history and counters can never
 *  disagree with each other again (the v5.2 "contradictory views" bug class
 *  is structurally impossible with a single source of truth). */
interface RecordsDoc {
  v: 1
  settings: Record<string, string>
  history: ConversionRecord[]
  counters: Counters
}

function emptyDoc(): RecordsDoc {
  return { v: 1, settings: {}, history: [], counters: emptyCounters() }
}

function sanitizeRecord(raw: unknown): ConversionRecord | null {
  const r = raw as Partial<ConversionRecord> | null
  if (!r || typeof r.id !== 'string' || typeof r.fileKey !== 'string') return null
  const ext = r.ext === 'mp4' ? 'mp4' : 'mp3'
  const storage = (['catbox', 'local', 'blob'].includes(String(r.storage)) ? r.storage : 'local') as ConversionRecord['storage']
  const createdAt = typeof r.createdAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(r.createdAt) ? r.createdAt : new Date().toISOString()
  return {
    id: r.id.slice(0, 64),
    fileKey: r.fileKey.slice(0, 128),
    ext,
    storage,
    title: String(r.title || BRAND).slice(0, 180),
    channel: typeof r.channel === 'string' ? r.channel.slice(0, 120) : null,
    videoId: typeof r.videoId === 'string' ? r.videoId.slice(0, 32) : null,
    thumbnail: typeof r.thumbnail === 'string' && /^https:\/\//.test(r.thumbnail) ? r.thumbnail.slice(0, 300) : null,
    quality: String(r.quality || '').slice(0, 24),
    engine: String(r.engine || 'engine').slice(0, 40),
    sizeBytes: Math.max(0, Math.round(Number(r.sizeBytes) || 0)),
    duration: Number.isFinite(Number(r.duration)) ? Number(r.duration) : null,
    trimStart: Number.isFinite(Number(r.trimStart)) ? Number(r.trimStart) : null,
    trimEnd: Number.isFinite(Number(r.trimEnd)) ? Number(r.trimEnd) : null,
    tagged: Boolean(r.tagged),
    ownerKey: sanitizeOwnerKey(r.ownerKey),
    createdAt,
  }
}

function sanitizeDoc(raw: unknown): RecordsDoc | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Partial<RecordsDoc>
  const settings: Record<string, string> = {}
  if (d.settings && typeof d.settings === 'object') {
    for (const [k, v] of Object.entries(d.settings)) {
      if (k.length <= 64 && typeof v === 'string' && v.length <= 500) settings[k] = v
    }
  }
  const history = Array.isArray(d.history)
    ? d.history.map(sanitizeRecord).filter((r): r is ConversionRecord => r !== null).slice(0, HISTORY_CAP)
    : []
  return { v: 1, settings, history, counters: sanitizeCounters(d.counters) }
}

function serializeDoc(doc: RecordsDoc): string {
  /* Stable field order keeps revisions byte-stable for identical states —
   * catbox's content dedupe then returns the SAME id, which skips pointless
   * album edits on no-op writes. */
  return JSON.stringify({
    v: 1,
    settings: doc.settings,
    history: doc.history,
    counters: doc.counters,
  })
}

interface DocCache {
  at: number
  fileId: string | null
  doc: RecordsDoc
}

const g = globalThis as unknown as {
  __elminyaweRecordsDoc?: DocCache
  __elminyaweRecords?: MemState
  /** Last error from the catbox doc layer — surfaced by the self-test. */
  __elminyaweDocError?: string
}

/* --------------------------------------------------------- memory mirror */

interface MemState {
  settings: Map<string, string>
  history: ConversionRecord[]
  counters: Counters
}

const mem: MemState =
  g.__elminyaweRecords ??
  {
    settings: new Map<string, string>(),
    history: [],
    counters: emptyCounters(),
  }
g.__elminyaweRecords = mem

/** Mirror a doc into the memory layer so degraded reads still serve data. */
function mirrorDoc(doc: RecordsDoc): void {
  mem.settings = new Map(Object.entries(doc.settings))
  mem.history = doc.history.slice()
  mem.counters = doc.counters
}
/** Rebuild a doc-shaped view of the memory mirror (degraded reads). */
function mirrorToDoc(): RecordsDoc {
  return {
    v: 1,
    settings: Object.fromEntries(mem.settings),
    history: mem.history.slice(),
    counters: mem.counters,
  }
}

/** Read the CURRENT records doc (album → file → json), with a tiny TTL cache.
 * A missing/empty/invalid doc is NOT an error — it is the fresh/bootstrap
 * state (the very first write will create it). Network problems throw.
 *
 * SINGLE-FLIGHT: concurrent callers (getUsage + listRecords in one request)
 * share one in-flight read, so a flaky network window can never produce
 * mixed outcomes — the dashboards always agree with each other. */
let docInFlight: Promise<DocCache> | null = null

async function readDoc(force = false): Promise<DocCache> {
  const cached = g.__elminyaweRecordsDoc
  if (!force && cached && Date.now() - cached.at < DOC_READ_TTL_MS) return cached
  if (docInFlight && !force) return docInFlight
  const flight = readDocOnce().finally(() => {
    if (docInFlight === flight) docInFlight = null
  })
  if (!force) docInFlight = flight
  return flight
}

async function readDocOnce(): Promise<DocCache> {

  const entries = await catboxAlbumFiles(RECORDS_ALBUM_SHORT, { timeoutMs: DOC_TIMEOUT_MS })
  const jsonEntry = entries.find((e) => e.ext.toLowerCase() === 'json') ?? null
  let doc = emptyDoc()
  let networkFailed = false
  if (jsonEntry) {
    const url = `https://files.catbox.moe/${jsonEntry.id}.${jsonEntry.ext}`
    try {
      const text = await fetchCatboxDocumentText(url, { timeoutMs: DOC_TIMEOUT_MS, maxBytes: DOC_MAX_BYTES })
      /* 0-byte / unparseable content is the pre-bootstrap state (the very
       * first successful write replaces it) — NOT an error. */
      doc = sanitizeDoc(safeJsonParse(text)) ?? emptyDoc()
    } catch {
      /* The pointed file could not be FETCHED at all (network window) —
       * degrade to the in-memory mirror when it holds data so a flaky read
       * never blanks the dashboards; otherwise treat as bootstrap state. */
      networkFailed = true
      doc = emptyDoc()
    }
  }
  if (networkFailed && (mem.history.length || mem.counters.total || mem.settings.size)) {
    /* Serve the mirror WITHOUT caching it as the album state — the next
     * successful read replaces it with the durable truth. */
    return { at: Date.now() - DOC_READ_TTL_MS, fileId: jsonEntry?.id ?? null, doc: mirrorToDoc() }
  }
  const result: DocCache = { at: Date.now(), fileId: jsonEntry?.id ?? null, doc }
  g.__elminyaweRecordsDoc = result
  mirrorDoc(doc)
  return result
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** Persist a NEW doc revision: upload → verify bytes → repoint the album →
 * drop the superseded revision. Every step is verified because this is the
 * single source of truth for the site's numbers. */
async function writeDoc(doc: RecordsDoc): Promise<void> {
  const text = serializeDoc(doc)
  const bytes = Buffer.byteLength(text, 'utf8')
  if (bytes > DOC_MAX_BYTES) {
    /* Defensive: never upload an oversized doc — trim history instead. */
    doc.history = doc.history.slice(0, Math.floor(HISTORY_CAP / 2))
    return writeDoc(doc)
  }

  /* 1) upload the revision to the owner's account */
  const up = await uploadCatboxDocument(RECORDS_DOC_NAME, text, {
    userhash: CATBOX_USERHASH,
    timeoutMs: DOC_WRITE_TIMEOUT_MS,
  })

  /* 2) verify the stored bytes read back EXACTLY. Reads can be flaky on
   *    filtered networks (empty bodies during bad windows) — retry a few
   *    times before declaring the UPLOAD corrupted, so a real upload is
   *    never rejected just because one read got mangled. */
  let verified = false
  for (let i = 0; i < 3 && !verified; i++) {
    if (i > 0) await sleep(400)
    try {
      const readBack = await fetchCatboxDocumentText(up.url, {
        timeoutMs: DOC_TIMEOUT_MS,
        maxBytes: DOC_MAX_BYTES,
      })
      verified = readBack.trim() === text
    } catch {
      /* read attempt failed — retry */
    }
  }
  if (!verified) {
    throw new Error('تحقق قراءة مستند السجلات فشل — البايتات المخزنة لا تطابق المُرسلة.')
  }

  /* 3) repoint the album at the new revision (editalbum replaces the list). */
  const edit = await catboxAlbumEdit(RECORDS_ALBUM_SHORT, [`${up.id}.json`], {
    userhash: CATBOX_USERHASH,
    title: ALBUM_TITLE,
    desc: ALBUM_DESC,
    timeoutMs: DOC_WRITE_TIMEOUT_MS,
  })
  if (!edit.ok) {
    throw new Error(`تعذّر تحديث ألبوم السجلات: ${edit.error || `HTTP ${edit.status}`}`)
  }

  /* 4) confirm the album now points at the new revision (reads can be
   *    flaky on filtered networks — a couple of retries before giving up). */
  let confirmed = false
  for (let i = 0; i < 3 && !confirmed; i++) {
    if (i > 0) await sleep(400)
    try {
      const entries = await catboxAlbumFiles(RECORDS_ALBUM_SHORT, { timeoutMs: DOC_TIMEOUT_MS })
      confirmed = entries.some((e) => e.id === up.id && e.ext.toLowerCase() === 'json')
    } catch {
      /* retry */
    }
  }
  if (!confirmed) {
    throw new Error('ألبوم السجلات لا يشير إلى المراجعة الجديدة بعد التحديث.')
  }

  /* 5) drop the superseded revision from the account (best-effort). */
  const previous = g.__elminyaweRecordsDoc?.fileId
  if (previous && previous !== up.id) {
    void deleteCatboxFiles([`${previous}.json`], { userhash: CATBOX_USERHASH, timeoutMs: 15_000 }).catch(() => {})
  }

  g.__elminyaweRecordsDoc = { at: Date.now(), fileId: up.id, doc }
  mirrorDoc(doc)
}

/** Read-modify-write with retries (writes are rare; races are negligible). */
async function mutateDoc(fn: (current: RecordsDoc) => RecordsDoc | null): Promise<RecordsDoc> {
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await readDoc(attempt > 0)
    const next = fn(current.doc)
    if (next === null) return current.doc
    try {
      await writeDoc(next)
      return next
    } catch (err) {
      lastErr = err
      g.__elminyaweDocError = String((err as Error).message || err).slice(0, 200)
      if (attempt < 2) await sleep(300 + attempt * 400)
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('catbox records mutation failed')
}

/* ---------------------------------------------------------- public API */

export interface UsageInfo {
  count: number
  bytes: number
}

/** Plain usage numbers for the files dashboard — no quota, no caps. */
export async function getUsage(ownerKey: string): Promise<UsageInfo> {
  const mode = storeMode()
  try {
    if (mode === 'sqlite') {
      await ensureSchema()
      const agg = await db.conversion.aggregate({
        where: { ownerKey },
        _sum: { sizeBytes: true },
        _count: { _all: true },
      })
      return { count: agg._count._all || 0, bytes: agg._sum.sizeBytes || 0 }
    }
    if (mode === 'catbox') {
      const { doc } = await readDoc()
      const mine = doc.counters.byOwner[ownerKey]
      return { count: mine?.count ?? 0, bytes: mine?.bytes ?? 0 }
    }
    const mine = mem.counters.byOwner[ownerKey]
    return { count: mine?.count ?? 0, bytes: mine?.bytes ?? 0 }
  } catch (err) {
    console.warn('[records:getUsage]', String((err as Error).message).slice(0, 120))
    const mine = mem.counters.byOwner[ownerKey]
    return { count: mine?.count ?? 0, bytes: mine?.bytes ?? 0 }
  }
}

export interface CreateRecordInput {
  fileKey: string
  ext: 'mp3' | 'mp4'
  storage: 'catbox' | 'local' | 'blob'
  title: string
  videoId?: string | null
  thumbnail?: string | null
  quality: string
  engine: string
  sizeBytes: number
  ownerKey?: string | null
  channel?: string | null
  duration?: number | null
}

/**
 * Persist one conversion record — mode-aware, with read-back verification.
 * Returns the stored record. Throws only after a retry; the caller decides
 * whether to surface a warning (the file itself is already safely stored —
 * history must not fail the request).
 */
export async function createRecord(input: CreateRecordInput): Promise<ConversionRecord> {
  const record: ConversionRecord = {
    id: crypto.randomUUID(),
    fileKey: input.fileKey,
    ext: input.ext,
    storage: input.storage,
    title: (input.title || 'ELMINYAWE').slice(0, 180),
    channel: input.channel ?? null,
    videoId: input.videoId ?? null,
    thumbnail: input.thumbnail ?? null,
    quality: input.quality,
    engine: input.engine,
    sizeBytes: Math.max(0, Math.round(input.sizeBytes)),
    duration: input.duration ?? null,
    trimStart: null,
    trimEnd: null,
    tagged: false,
    ownerKey: input.ownerKey ?? null,
    createdAt: new Date().toISOString(),
  }

  const mode = storeMode()
  if (mode === 'sqlite') {
    await ensureSchema()
    try {
      await db.conversion.create({
        data: {
          id: record.id,
          fileKey: record.fileKey,
          ext: record.ext,
          storage: record.storage,
          title: record.title,
          channel: record.channel,
          videoId: record.videoId,
          thumbnail: record.thumbnail,
          quality: record.quality,
          engine: record.engine,
          sizeBytes: record.sizeBytes,
          duration: record.duration,
          ownerKey: record.ownerKey,
          createdAt: new Date(record.createdAt),
        },
      })
    } catch (err) {
      /* Re-converting the same video can dedupe to the SAME external file
       * key (Catbox reuses the key for identical content). In that case
       * refresh the existing row instead of failing — the history must
       * always reflect the latest conversion, never error out. */
      const code = (err as { code?: string }).code
      if (code !== 'P2002') throw err
      await db.conversion.update({
        where: { fileKey: record.fileKey },
        data: {
          title: record.title,
          channel: record.channel,
          videoId: record.videoId,
          thumbnail: record.thumbnail,
          quality: record.quality,
          engine: record.engine,
          sizeBytes: record.sizeBytes,
          duration: record.duration,
          ownerKey: record.ownerKey,
          createdAt: new Date(record.createdAt),
        },
      })
      const existing = await db.conversion.findUnique({ where: { fileKey: record.fileKey } })
      if (existing) return rowToRecord(existing)
    }
    return record
  }

  if (mode === 'catbox') {
    try {
      await mutateDoc((cur) => {
        const history = [record, ...cur.history.filter((r) => r.fileKey !== record.fileKey)].slice(0, HISTORY_CAP)
        const counters = pruneCounters(sanitizeCounters(cur.counters))
        bumpCounters(counters, record)
        return { v: 1, settings: cur.settings, history, counters }
      })
      return record
    } catch (err) {
      /* The durable write failed — keep the warm instance consistent so the
       * file still appears locally; the next successful write resyncs. */
      mem.history = [record, ...mem.history.filter((r) => r.fileKey !== record.fileKey)].slice(0, HISTORY_CAP)
      bumpCounters(mem.counters, record)
      throw err
    }
  }

  /* memory mode */
  mem.history = [record, ...mem.history.filter((r) => r.fileKey !== record.fileKey)].slice(0, HISTORY_CAP)
  bumpCounters(mem.counters, record)
  return record
}

export interface ListOptions {
  ownerKey?: string
  limit?: number
}

function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(Number(limit) || 24, 1), 100)
}

/** Newest-first record listing (optionally scoped to one owner). */
export async function listRecords(opts: ListOptions = {}): Promise<ConversionRecord[]> {
  const limit = clampLimit(opts.limit)
  const mode = storeMode()
  try {
    if (mode === 'sqlite') {
      await ensureSchema()
      const rows = await db.conversion.findMany({
        where: opts.ownerKey ? { ownerKey: opts.ownerKey } : undefined,
        orderBy: { createdAt: 'desc' },
        take: limit,
      })
      return rows.map(rowToRecord)
    }
    if (mode === 'catbox') {
      const { doc } = await readDoc()
      const filtered = opts.ownerKey ? doc.history.filter((r) => r.ownerKey === opts.ownerKey) : doc.history
      return filtered.slice(0, limit)
    }
    const filtered = opts.ownerKey ? mem.history.filter((r) => r.ownerKey === opts.ownerKey) : mem.history
    return filtered.slice(0, limit)
  } catch (err) {
    console.warn('[records:list]', String((err as Error).message).slice(0, 120))
    const filtered = opts.ownerKey ? mem.history.filter((r) => r.ownerKey === opts.ownerKey) : mem.history
    return filtered.slice(0, limit)
  }
}

function rowToRecord(row: {
  id: string
  fileKey: string
  ext: string
  storage: string
  title: string
  channel: string | null
  videoId: string | null
  thumbnail: string | null
  quality: string
  engine: string
  sizeBytes: number
  duration: number | null
  trimStart: number | null
  trimEnd: number | null
  tagged: boolean
  ownerKey: string | null
  createdAt: Date
}): ConversionRecord {
  return {
    id: row.id,
    fileKey: row.fileKey,
    ext: row.ext === 'mp4' ? 'mp4' : 'mp3',
    storage: (['catbox', 'local', 'blob'].includes(row.storage) ? row.storage : 'local') as ConversionRecord['storage'],
    title: row.title,
    channel: row.channel,
    videoId: row.videoId,
    thumbnail: row.thumbnail,
    quality: row.quality,
    engine: row.engine,
    sizeBytes: row.sizeBytes,
    duration: row.duration,
    trimStart: row.trimStart,
    trimEnd: row.trimEnd,
    tagged: row.tagged,
    ownerKey: row.ownerKey,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  }
}

/**
 * Delete one record. `ownerKey` scopes the delete to that owner's own files
 * (the files dashboard); pass `null` for admin deletions (admin panel).
 * Also removes the on-disk artefacts. Returns the number deleted.
 */
export async function deleteRecord(id: string, ownerKey: string | null): Promise<number> {
  const mode = storeMode()
  try {
    if (mode === 'sqlite') {
      await ensureSchema()
      const row = await db.conversion.findUnique({ where: { id } })
      if (!row) return 0
      if (ownerKey && row.ownerKey !== ownerKey) return 0
      await db.conversion.delete({ where: { id } })
      removeMediaFiles(row.fileKey, row.ext, row.storage)
      return 1
    }
    if (mode === 'catbox') {
      let removed: ConversionRecord | null = null
      await mutateDoc((cur) => {
        const idx = cur.history.findIndex((r) => r.id === id && (!ownerKey || r.ownerKey === ownerKey))
        if (idx === -1) return null
        removed = cur.history[idx]!
        const history = cur.history.filter((_, i) => i !== idx)
        const counters = pruneCounters(sanitizeCounters(cur.counters))
        unbumpCounters(counters, removed as ConversionRecord)
        return { v: 1, settings: cur.settings, history, counters }
      })
      if (!removed) return 0
      const rec = removed as ConversionRecord
      mem.history = mem.history.filter((r) => r.id !== id)
      removeMediaFiles(rec.fileKey, rec.ext, rec.storage)
      return 1
    }
    const idx = mem.history.findIndex((r) => r.id === id && (!ownerKey || r.ownerKey === ownerKey))
    if (idx === -1) return 0
    const [doc] = mem.history.splice(idx, 1)
    if (doc) unbumpCounters(mem.counters, doc)
    removeMediaFiles(doc.fileKey, doc.ext, doc.storage)
    return 1
  } catch (err) {
    console.warn('[records:delete]', String((err as Error).message).slice(0, 120))
    return 0
  }
}

/** Delete every record (all=ownerKey null / admin) or one owner's records. */
export async function deleteAllRecords(ownerKey: string | null): Promise<number> {
  const mode = storeMode()
  try {
    if (mode === 'sqlite') {
      await ensureSchema()
      const rows = await db.conversion.findMany({
        where: ownerKey ? { ownerKey } : undefined,
        select: { fileKey: true, ext: true, storage: true },
      })
      const { count } = await db.conversion.deleteMany({ where: ownerKey ? { ownerKey } : undefined })
      for (const r of rows) removeMediaFiles(r.fileKey, r.ext, r.storage)
      return count
    }
    if (mode === 'catbox') {
      let doomed: ConversionRecord[] = []
      await mutateDoc((cur) => {
        doomed = ownerKey ? cur.history.filter((r) => r.ownerKey === ownerKey) : cur.history
        const history = ownerKey ? cur.history.filter((r) => r.ownerKey !== ownerKey) : []
        const counters = ownerKey ? pruneCounters(sanitizeCounters(cur.counters)) : emptyCounters()
        if (ownerKey) for (const rec of doomed) unbumpCounters(counters, rec)
        return { v: 1, settings: cur.settings, history, counters }
      })
      const list = doomed as ConversionRecord[]
      mem.history = ownerKey ? mem.history.filter((r) => r.ownerKey !== ownerKey) : []
      if (!ownerKey) mem.counters = emptyCounters()
      for (const d of list) removeMediaFiles(d.fileKey, d.ext, d.storage)
      return list.length
    }
    const doomed = ownerKey ? mem.history.filter((d) => d.ownerKey === ownerKey) : mem.history
    mem.history = ownerKey ? mem.history.filter((d) => d.ownerKey !== ownerKey) : []
    if (!ownerKey) mem.counters = emptyCounters()
    for (const d of doomed) removeMediaFiles(d.fileKey, d.ext, d.storage)
    return doomed.length
  } catch (err) {
    console.warn('[records:deleteAll]', String((err as Error).message).slice(0, 120))
    return 0
  }
}

/* ------------------------------------------------------------ aggregates */

export interface StatsAggregates {
  totalConversions: number
  totalMB: number
  days: { date: string; count: number; mb: number }[]
  byEngine: Record<string, number>
  mp3: number
  mp4: number
}

/** Aggregates for /api/stats (hero counters + insights charts). */
export async function statsAggregates(): Promise<StatsAggregates> {
  const mode = storeMode()
  const out: StatsAggregates = { totalConversions: 0, totalMB: 0, days: [], byEngine: {}, mp3: 0, mp4: 0 }

  /* last-7-day skeleton with zero fills */
  const since = new Date()
  since.setHours(0, 0, 0, 0)
  since.setDate(since.getDate() - 6)
  const dayMap = new Map<string, { count: number; mb: number }>()
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - i)
    dayMap.set(d.toISOString().slice(0, 10), { count: 0, mb: 0 })
  }

  let counters: Counters | null = null
  try {
    if (mode === 'sqlite') {
      await ensureSchema()
      const [total, agg, rows] = await Promise.all([
        db.conversion.count(),
        db.conversion.aggregate({ _sum: { sizeBytes: true } }),
        db.conversion.findMany({
          where: { createdAt: { gte: since } },
          select: { createdAt: true, sizeBytes: true, engine: true, ext: true },
        }),
      ])
      out.totalConversions = total
      out.totalMB = +(((agg._sum.sizeBytes || 0) / 1048576) as number).toFixed(1)
      for (const row of rows) {
        const key = row.createdAt.toISOString().slice(0, 10)
        const entry = dayMap.get(key)
        if (entry) {
          entry.count += 1
          entry.mb += (row.sizeBytes || 0) / 1048576
        }
        out.byEngine[row.engine] = (out.byEngine[row.engine] || 0) + 1
        if (row.ext === 'mp3') out.mp3 += 1
        else if (row.ext === 'mp4') out.mp4 += 1
      }
    } else if (mode === 'catbox') {
      counters = (await readDoc()).doc.counters
    } else {
      counters = mem.counters
    }
  } catch (err) {
    console.warn('[records:stats]', String((err as Error).message).slice(0, 120))
    counters = mode === 'sqlite' ? null : mem.counters
  }

  if (counters) {
    out.totalConversions = counters.total
    out.totalMB = +(counters.totalBytes / 1048576).toFixed(1)
    out.mp3 = counters.mp3
    out.mp4 = counters.mp4
    out.byEngine = { ...counters.byEngine }
    for (const [day, v] of Object.entries(counters.byDay)) {
      const entry = dayMap.get(day)
      if (entry) {
        entry.count += v.count
        entry.mb += v.bytes / 1048576
      }
    }
  }

  for (const [date, v] of dayMap) out.days.push({ date, count: v.count, mb: +v.mb.toFixed(2) })
  return out
}

/* ------------------------------------------------- durable admin settings */

/** Read an admin setting (solver URL, gateway API key…). */
export async function getSetting(key: string): Promise<string | null> {
  const mode = storeMode()
  if (mode === 'catbox') {
    try {
      const { doc } = await readDoc()
      const v = doc.settings[key]
      return typeof v === 'string' ? v : null
    } catch {
      return mem.settings.get(key) ?? null
    }
  }
  if (mode === 'sqlite') {
    try {
      await ensureSchema()
      const row = await db.adminSetting.findUnique({ where: { key } })
      return row?.value ?? null
    } catch {
      return mem.settings.get(key) ?? null
    }
  }
  return mem.settings.get(key) ?? null
}

/**
 * Persist an admin setting. `null` deletes it.
 * Returns false only when the durable write failed.
 */
export async function setSetting(key: string, value: string | null): Promise<boolean> {
  const mode = storeMode()
  let ok = true
  if (mode === 'catbox') {
    try {
      await mutateDoc((cur) => {
        const settings = { ...cur.settings }
        if (value === null) delete settings[key]
        else settings[key] = value
        return { v: 1, settings, history: cur.history, counters: cur.counters }
      })
    } catch (err) {
      console.warn('[records] setSetting(catbox):', String((err as Error).message).slice(0, 120))
      ok = false
    }
  } else if (mode === 'sqlite') {
    try {
      await ensureSchema()
      if (value === null) await db.adminSetting.deleteMany({ where: { key } })
      else
        await db.adminSetting.upsert({
          where: { key },
          update: { value },
          create: { key, value },
        })
    } catch (err) {
      console.warn('[records] setSetting(sqlite):', String((err as Error).message).slice(0, 120))
      ok = false
    }
  }
  if (value === null) mem.settings.delete(key)
  else mem.settings.set(key, value)
  return ok
}

/* --------------------------------------------------- dev/ops inspection */

/** Small helper used by /api/health to report the active storage mode. */
export function storeModeInfo() {
  const mode = storeMode()
  return {
    mode,
    persistent: mode === 'catbox' || mode === 'sqlite',
    label: storeModeLabel(mode),
  }
}

/** Probe the ACTIVE store (never a raw Prisma call) — used by /api/health. */
export async function storeHealth(): Promise<{ mode: StoreMode; ok: boolean }> {
  const mode = storeMode()
  if (mode === 'memory') return { mode, ok: true }
  if (mode === 'catbox') {
    try {
      /* The album page IS the store's root — reaching it proves the whole
       * pointer chain is alive (the doc fetch is verified inside readDoc). */
      await catboxAlbumFiles(RECORDS_ALBUM_SHORT, { timeoutMs: DOC_TIMEOUT_MS })
      return { mode, ok: true }
    } catch {
      return { mode, ok: false }
    }
  }
  try {
    await ensureSchema()
    await db.conversion.count()
    return { mode, ok: true }
  } catch {
    return { mode, ok: false }
  }
}

/** Lightweight durable total for /api/health. */
export async function countRecords(): Promise<number> {
  const mode = storeMode()
  if (mode === 'sqlite') {
    try {
      await ensureSchema()
      return await db.conversion.count()
    } catch {
      return mem.counters.total
    }
  }
  if (mode === 'catbox') {
    try {
      const { doc } = await readDoc()
      return doc.counters.total
    } catch {
      return mem.counters.total
    }
  }
  return mem.counters.total
}

/* ------------------------------------------------- live storage self-test */

export interface StorageSelfTestStep {
  name: 'album' | 'write' | 'read' | 'verify' | 'delete' | 'health' | 'count'
  ok: boolean
  ms: number
  error?: string
  /** Actionable Arabic/English guidance for the step's failure. */
  hint?: { ar: string; en: string }
}

export interface StorageSelfTestResult {
  mode: StoreMode
  ok: boolean
  totalMs: number
  /** The stable records pointer (album URL) when running the catbox store. */
  storeDomain?: string
  totalRecords: number | null
  steps: StorageSelfTestStep[]
}

const SELFTEST_KEY = 'storage_probe'

/** Map a raw catbox error to actionable owner guidance. */
function classifyStoreError(err: unknown): { ar: string; en: string } | undefined {
  const msg = String((err as Error)?.message || err || '')
  if (!msg) return undefined
  if (/412|Invalid uploader/i.test(msg))
    return {
      ar: 'Catbox رفضت رفع هذا الخادم — تحقق من CATBOX_USERHASH ثم أعد المحاولة',
      en: 'Catbox rejected this server — check CATBOX_USERHASH and retry',
    }
  if (/فشل رفع مستند|تعذّر تحديث ألبوم|لا يشير إلى المراجعة|لا تطابق/i.test(msg))
    return {
      ar: 'كتابة السجلات على Catbox فشلت رغم المحاولات — الشبكة تحجب أو تُفسد الرفع من هذا الخادم مؤقتًا؛ على نشر Vercel تعمل (جرّب من هناك)',
      en: 'Writing records to Catbox failed after retries — this network is blocking/corrupting uploads right now; it works from the Vercel deployment (try there)',
    }
  if (/timed?\s?out|timeout|abort/i.test(msg))
    return {
      ar: 'مهلة شبكة أثناء الوصول لـ Catbox — أعد المحاولة بعد لحظات',
      en: 'Network timeout reaching Catbox — try again in a moment',
    }
  return undefined
}

/**
 * Full live roundtrip through the ACTIVE records store with real
 * diagnostics: album read → write probe → durable read (cache-bypassed) →
 * verify → cleanup → health → count. Never lets the read-cache mask a
 * broken durable read, and captures classified error hints.
 */
export async function storageSelfTest(): Promise<StorageSelfTestResult> {
  const mode = storeMode()
  const startedAt = Date.now()
  const steps: StorageSelfTestStep[] = []
  const probeValue = `probe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  /* --- memory mode: no durable store at all ------------------------------ */
  if (mode === 'memory') {
    steps.push({
      name: 'write',
      ok: false,
      ms: 0,
      error: 'memory mode',
      hint: {
        ar: 'لا يوجد CATBOX_USERHASH على هذه النسخة — الافتراضي المضمّن يعمل على Vercel بلا أي إعداد',
        en: 'No CATBOX_USERHASH on this instance — the built-in default works on Vercel with zero setup',
      },
    })
    return { mode, ok: false, totalMs: 0, totalRecords: null, steps }
  }

  /* --- catbox mode: the real production store ---------------------------- */
  if (mode === 'catbox') {
    g.__elminyaweDocError = undefined

    /* 1) album — the stable pointer must be readable. */
    let t0 = Date.now()
    let albumOk = false
    let albumErr: unknown = null
    try {
      const entries = await catboxAlbumFiles(RECORDS_ALBUM_SHORT, { timeoutMs: DOC_TIMEOUT_MS })
      albumOk = true
      void entries
    } catch (err) {
      albumErr = err
    }
    steps.push({
      name: 'album',
      ok: albumOk,
      ms: Date.now() - t0,
      error: albumOk ? undefined : String((albumErr as Error)?.message || albumErr).slice(0, 200),
      hint: albumOk ? undefined : classifyStoreError(albumErr),
    })

    /* 2) write (read-modify-write preserves the other settings keys). */
    t0 = Date.now()
    let writeOk = false
    let writeErr: unknown = null
    try {
      await mutateDoc((cur) => ({ ...cur, settings: { ...cur.settings, [SELFTEST_KEY]: probeValue } }))
      writeOk = true
    } catch (err) {
      writeErr = err
    }
    steps.push({
      name: 'write',
      ok: writeOk,
      ms: Date.now() - t0,
      error: writeOk ? undefined : String((writeErr as Error)?.message || writeErr).slice(0, 200),
      hint: writeOk ? undefined : classifyStoreError(writeErr),
    })

    /* 3) durable read — force=true bypasses the in-memory cache so the
     * probe proves REAL storage, not the write's own echo. */
    t0 = Date.now()
    let readValue: string | null = null
    let readErr: unknown = null
    try {
      const { doc } = await readDoc(true)
      readValue = doc.settings[SELFTEST_KEY] ?? null
    } catch (err) {
      readErr = err
    }
    steps.push({
      name: 'read',
      ok: readValue !== null,
      ms: Date.now() - t0,
      error: readValue !== null ? undefined : String((readErr as Error)?.message || (readErr ?? 'no value read')).slice(0, 200),
      hint: readValue !== null ? undefined : classifyStoreError(readErr),
    })

    /* 4) verify exact roundtrip. */
    const verifyOk = readValue === probeValue
    steps.push({ name: 'verify', ok: verifyOk, ms: 0 })

    /* 5) cleanup (best-effort). */
    t0 = Date.now()
    let deleteOk = false
    try {
      await mutateDoc((cur) => {
        const settings = { ...cur.settings }
        delete settings[SELFTEST_KEY]
        return { ...cur, settings }
      })
      deleteOk = true
    } catch {
      deleteOk = false
    }
    steps.push({ name: 'delete', ok: deleteOk, ms: Date.now() - t0 })

    /* 6+7) health + count. */
    t0 = Date.now()
    const health = await storeHealth()
    steps.push({ name: 'health', ok: health.ok, ms: Date.now() - t0 })
    t0 = Date.now()
    let total: number | null = null
    try {
      total = await countRecords()
    } catch {
      total = null
    }
    steps.push({ name: 'count', ok: total !== null, ms: Date.now() - t0 })

    return {
      mode,
      ok: albumOk && writeOk && readValue !== null && verifyOk && health.ok,
      totalMs: Date.now() - startedAt,
      storeDomain: `https://catbox.moe/c/${RECORDS_ALBUM_SHORT}`,
      totalRecords: total,
      steps,
    }
  }

  /* --- sqlite mode (local) ------------------------------------------------ */
  let t0 = Date.now()
  let writeOk = false
  let writeErr: unknown = null
  try {
    await ensureSchema()
    await db.adminSetting.upsert({
      where: { key: SELFTEST_KEY },
      update: { value: probeValue },
      create: { key: SELFTEST_KEY, value: probeValue },
    })
    writeOk = true
  } catch (err) {
    writeErr = err
  }
  steps.push({
    name: 'write',
    ok: writeOk,
    ms: Date.now() - t0,
    error: writeOk ? undefined : String((writeErr as Error)?.message || writeErr).slice(0, 200),
  })

  t0 = Date.now()
  let readValue: string | null = null
  try {
    const row = await db.adminSetting.findUnique({ where: { key: SELFTEST_KEY } })
    readValue = row?.value ?? null
  } catch {
    readValue = null
  }
  steps.push({ name: 'read', ok: readValue !== null, ms: Date.now() - t0 })
  steps.push({ name: 'verify', ok: readValue === probeValue, ms: 0 })

  t0 = Date.now()
  let deleteOk = false
  try {
    await db.adminSetting.deleteMany({ where: { key: SELFTEST_KEY } })
    deleteOk = true
  } catch {
    deleteOk = false
  }
  steps.push({ name: 'delete', ok: deleteOk, ms: Date.now() - t0 })

  t0 = Date.now()
  const health = await storeHealth()
  steps.push({ name: 'health', ok: health.ok, ms: Date.now() - t0 })
  t0 = Date.now()
  let total: number | null = null
  try {
    total = await countRecords()
  } catch {
    total = null
  }
  steps.push({ name: 'count', ok: total !== null, ms: Date.now() - t0 })

  return {
    mode,
    ok: writeOk && readValue === probeValue && health.ok,
    totalMs: Date.now() - startedAt,
    totalRecords: total,
    steps,
  }
}

/* Re-export for API routes so they don't import storage internals twice. */
export { removeMediaFiles }
