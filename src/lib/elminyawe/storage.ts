import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { Readable } from 'node:stream'
import { uploadCatbox, probeCatboxObject, catboxFile } from './catbox'
import { BRAND, CATBOX_USERHASH, MAX_FILE_BYTES, MEDIA_DIR, type MediaExt } from './brand'

/* ============================================================================
 *  Media file persistence — v5.4 (owner's directive: Catbox ONLY, no Blob).
 *
 *  THE LADDER (exactly two rungs):
 *    1. Catbox — the ONLY durable home for media files. The upload is
 *       streamed (never buffered in RAM), retried up to 3 times with
 *       backoff and a budget-aware timeout so LARGE FILES (tens of MB)
 *       can use the whole remaining request time instead of a fixed
 *       120s cutoff, and verified byte-real after landing.
 *    2. Local disk under MEDIA_DIR — OFF-Vercel only (dev / self-host,
 *       where the disk actually persists). On Vercel, a Catbox failure
 *       after all retries FAILS the conversion with a clear Arabic
 *       message — the v5.2 class of "dead L-links" (ephemeral lambda
 *       disk dying with the instance → 404 later) never comes back.
 *
 *  NUMBERS (records / history / settings) live in records.ts — a single
 *  JSON document on the owner's Catbox account (album-indexed). Media FILES
 *  never touch any other storage either (owner's explicit design, restated
 *  as "التخزين بشكل كامل يكون على Catbox" — v5.4).
 * ============================================================================ */

export interface StoredMedia {
  fileKey: string
  ext: MediaExt
  storage: 'catbox' | 'local'
  remoteUrl?: string
  localPath?: string
  sizeBytes: number
}

export interface BrandedFile {
  id: string
  ext: MediaExt
  storage: 'catbox' | 'local'
  url: string
  /** Local mirror path (for catbox files mirrored on disk). */
  localPath?: string
}

/** Local-disk files (dev/self-host legacy keys). */
const LOCAL_PREFIX = 'L'
/** Catbox files are mirrored locally under this prefix so playback survives upstream flakiness. */
const MIRROR_PREFIX = 'C'

function mirrorPath(key: string, ext: MediaExt): string {
  return path.join(MEDIA_DIR, `${MIRROR_PREFIX}${key}.${ext}`)
}

/** Best-effort local mirror of an uploaded catbox file (never fails the pipeline). */
function mirrorLocally(srcFile: string, key: string, ext: MediaExt): string | null {
  try {
    fs.mkdirSync(MEDIA_DIR, { recursive: true })
    const dest = mirrorPath(key, ext)
    fs.copyFileSync(srcFile, dest)
    return dest
  } catch (err) {
    console.warn('[storage] local mirror failed (non-fatal):', String((err as Error).message || err).slice(0, 160))
    return null
  }
}

/** Public branded path for a stored media file. */
export function brandedPathForKey(fileKey: string, ext: MediaExt): string {
  return `/e/${BRAND}-${fileKey}.${ext}`
}

/**
 * Resolve a public /e/:filename back to a media source.
 * Catbox keys are opaque and STATELESS — https://files.catbox.moe/{key}.{ext}
 * works forever without any database. Local keys (L…) map to files under
 * MEDIA_DIR. Catbox files with a warm local mirror (C…) stream from disk.
 */
export function resolveBrandedFile(filename: string): BrandedFile | null {
  if (typeof filename !== 'string') return null
  const match = new RegExp(`^${BRAND}-([A-Za-z0-9_-]{1,128})\\.(mp3|mp4)$`).exec(filename)
  if (!match) return null
  const [, key, ext] = match
  if (key.startsWith(LOCAL_PREFIX) && key.length > LOCAL_PREFIX.length) {
    const localPath = path.join(MEDIA_DIR, `${key}.${ext}`)
    if (fs.existsSync(localPath)) {
      return { id: key, ext: ext as MediaExt, storage: 'local', url: localPath }
    }
    return null
  }
  // Catbox key — prefer serving from the local mirror when it exists (instant
  // + reliable), otherwise proxy/redirect from the remote storage. Mirrors are
  // named C{key}.{ext}; the public URL carries the bare catbox id, so probe by
  // existence — not by key prefix.
  const catboxUrl = `https://files.catbox.moe/${key}.${ext}`
  const mirrored = mirrorPath(key, ext as MediaExt)
  if (fs.existsSync(mirrored)) {
    return { id: key, ext: ext as MediaExt, storage: 'catbox', url: catboxUrl, localPath: mirrored }
  }
  return { id: key, ext: ext as MediaExt, storage: 'catbox', url: catboxUrl }
}

function magicBytesValid(head: Buffer, ext: MediaExt): boolean {
  return ext === 'mp3'
    ? head.toString('ascii', 0, 3) === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)
    : ['ftyp', 'styp'].includes(head.toString('ascii', 4, 8))
}

export function assertMediaFile(file: string, ext: MediaExt): number {
  const stat = fs.statSync(file)
  if (!stat.isFile() || stat.size < 12 || stat.size > MAX_FILE_BYTES) {
    throw new Error('الملف فارغ أو تجاوز الحد الأقصى.')
  }
  const fd = fs.openSync(file, 'r')
  const bytes = Buffer.alloc(16)
  try {
    fs.readSync(fd, bytes, 0, 16, 0)
  } finally {
    fs.closeSync(fd)
  }
  if (!magicBytesValid(bytes, ext)) throw new Error(`ملف التحويل ليس ${ext.toUpperCase()} حقيقيًا.`)
  return stat.size
}

/** Progress note emitted by saveMedia — optional localized terminal line. */
export interface StorageProgressNote {
  message: string
  en: string
}

/** Catbox upload attempts — transient ISP/undici flakiness is documented
 * upstream, and the owner's live deployment (v5.2) lost a 25MB file to a
 * SINGLE-attempt failure. Four attempts + growing backoff ride out brief
 * catbox bad-windows instead of handing back a dead link. */
const CATBOX_ATTEMPTS = 4
/** Never spend more than this on a single upload attempt (seconds of network). */
const CATBOX_ATTEMPT_CAP_MS = 170_000

/**
 * Persist the converted file — Catbox only (v5.4).
 * Retries with backoff; each attempt gets a budget-aware timeout so large
 * files can actually finish inside the request deadline. On Vercel a final
 * failure THROWS (no ephemeral-disk dead links); off-Vercel the local disk
 * remains the dev/self-host fallback where it is genuinely durable.
 */
export async function saveMedia(
  file: string,
  ext: MediaExt,
  opts: {
    deadlineAt: number
    signal?: AbortSignal
    onProgress?: (stage: string, note?: StorageProgressNote) => void
  }
): Promise<StoredMedia> {
  const sizeBytes = assertMediaFile(file, ext)
  const onProgress = opts.onProgress ?? (() => {})
  const sizeMB = (sizeBytes / 1048576).toFixed(1)

  let lastError = ''
  for (let attempt = 1; attempt <= CATBOX_ATTEMPTS; attempt++) {
    if (opts.signal?.aborted) throw new Error('أُلغِيَ التحويل بعد إغلاق الطلب.')
    const remaining = Math.max(opts.deadlineAt - Date.now(), 8_000)
    const budget = Math.min(remaining, CATBOX_ATTEMPT_CAP_MS)
    try {
      onProgress('upload', {
        message:
          attempt === 1
            ? `رفع الملف إلى التخزين الدائم Catbox (${sizeMB}MB)...`
            : `إعادة محاولة الرفع إلى Catbox (${attempt}/${CATBOX_ATTEMPTS})...`,
        en:
          attempt === 1
            ? `Uploading the file to permanent Catbox storage (${sizeMB}MB)...`
            : `Retrying the Catbox upload (${attempt}/${CATBOX_ATTEMPTS})...`,
      })
      const saved = await uploadCatbox(file, {
        userhash: CATBOX_USERHASH,
        maxBytes: MAX_FILE_BYTES,
        timeoutMs: budget,
        signal: opts.signal,
      })
      onProgress('verify')
      let check
      for (let i = 0; i < 3; i++) {
        check = await probeCatboxObject(saved.url, ext, {
          timeoutMs: 15_000,
          signal: opts.signal,
        })
        if (check.ok) {
          // Keep a local mirror so playback never depends on catbox availability.
          mirrorLocally(file, saved.id, ext)
          return { fileKey: saved.id, ext, storage: 'catbox', remoteUrl: saved.url, sizeBytes }
        }
        if (i < 2) await new Promise((r) => setTimeout(r, Math.min((i + 1) * 1000, 3000)))
      }
      throw new Error(`لم تُتح قراءة الملف المرفوع من Catbox (HTTP ${check?.status ?? 'غير متاح'}).`)
    } catch (err) {
      if (opts.signal?.aborted) throw new Error('أُلغِيَ التحويل بعد إغلاق الطلب.')
      lastError = String((err as Error).message || err)
      console.warn(`[storage] Catbox attempt ${attempt}/${CATBOX_ATTEMPTS} failed:`, lastError.slice(0, 200))
      if (attempt < CATBOX_ATTEMPTS) {
        /* Backoff (2s · 4s · 6s) — a FRESH connection on the next attempt
         * works around the documented dead keep-alive socket stalls, and
         * the growing gap rides out short catbox bad-windows. Re-uploading
         * identical bytes is safe: Catbox content-dedupes to the same key. */
        await new Promise((r) => setTimeout(r, 2000 * attempt))
      }
    }
  }

  /* On Vercel there is no durable disk: fail LOUDLY instead of handing the
   * user a link that dies with the instance (the v5.2 dead-link bug). */
  if (process.env.VERCEL) {
    throw new Error(
      `تعذّر الحفظ في التخزين الخارجي Catbox بعد ${CATBOX_ATTEMPTS} محاولات — اضغط «تحويل» مرة أخرى وستنجح عادةً. (${lastError.slice(0, 120)})`
    )
  }

  // Local fallback — dev / self-host (persistent disk there).
  onProgress('store', {
    message: 'تعذّر الوصول للتخزين الخارجي — حفظ محلي مؤقت (وضع التطوير)...',
    en: 'External storage unreachable — saving locally (dev mode)...',
  })
  fs.mkdirSync(MEDIA_DIR, { recursive: true })
  const key = `${LOCAL_PREFIX}${crypto.randomBytes(8).toString('hex')}`
  const dest = path.join(MEDIA_DIR, `${key}.${ext}`)
  await fs.promises.copyFile(file, dest)
  return { fileKey: key, ext, storage: 'local', localPath: dest, sizeBytes }
}

/** Build a Web ReadableStream for a local media file (for /e route responses). */
export function localFileStream(localPath: string, range?: { start: number; end: number }): ReadableStream<Uint8Array> {
  const stream = fs.createReadStream(localPath, range)
  return Readable.toWeb(stream) as ReadableStream<Uint8Array>
}

export { catboxFile }
