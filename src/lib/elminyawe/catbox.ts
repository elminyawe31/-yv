import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { Readable } from 'node:stream'

/* ============================================================================
 *  ELMINYAWE × Catbox — the ONLY durable home for media files (v5.4).
 *
 *  Verified against the official sources (catbox.moe/faq.php + /tools.php):
 *   • API endpoint  : POST https://catbox.moe/user/api.php (multipart)
 *       reqtype=fileupload   userhash   fileToUpload=<file>
 *       reqtype=urlupload    userhash   url=<remote url>
 *       reqtype=deletefiles  userhash   files="a.mp3 b.mp4"  (SPACE-separated
 *                                   FILENAMES — ids, not full URLs)
 *   • Permanence    : uploads tied to a user account (userhash) are PERMANENT;
 *                     anonymous uploads expire after 2 years of inactivity —
 *                     therefore every upload here carries the owner's userhash.
 *   • Integrity     : Catbox stores files byte-identical (no re-encode, no
 *                     metadata stripping) — what we upload is what plays.
 *   • Content rules : banned types (exe · scr · cpl · doc-family · jar) never
 *                     include mp3/mp4, which are fully supported.
 *   • Connectivity  : some countries/ISPs DNS- or IP-block catbox domains
 *                     (Australia, Iran, Turkey, Comcast…). That is why every
 *                     network call here is retried with fresh connections,
 *                     and the /e/ route keeps a byte-proxy escape hatch.
 *   • Size ceiling  : 200MB per file on Catbox's side; the app enforces its
 *                     own lower cap (MAX_FILE_MB, default 80) so uploads fit
 *                     comfortably inside the request deadline.
 * ============================================================================ */

const API_URL = 'https://catbox.moe/user/api.php'
const STORAGE_HOST = 'files.catbox.moe'

/** Catbox's own hard per-file limit (from the service docs). */
export const CATBOX_MAX_FILE_MB = 200

export interface CatboxFile {
  id: string
  ext: string
  url: string
}

export function catboxFile(url: string, expectedExt?: string): CatboxFile | null {
  try {
    const parsed = new URL(url)
    if (
      parsed.protocol !== 'https:' ||
      parsed.hostname !== STORAGE_HOST ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      parsed.search ||
      parsed.hash
    )
      return null
    const match = /^\/([A-Za-z0-9_-]{1,128})\.(mp3|mp4)$/.exec(parsed.pathname)
    if (!match || (expectedExt && expectedExt !== match[2])) return null
    return { id: match[1], ext: match[2], url: parsed.href }
  } catch {
    return null
  }
}

export interface UploadResult {
  url: string
  id: string
  ext: string
}

/** Parse + validate the plain-text API response (never leaks the userhash). */
function parseApiText(text: string, userhash: string): string {
  return text.trim().replaceAll(userhash, '[redacted]').slice(0, 160)
}

/** One streamed multipart upload attempt — the file never lands in RAM. */
export async function uploadCatbox(
  filePath: string,
  opts: { userhash: string; maxBytes: number; timeoutMs?: number; signal?: AbortSignal }
): Promise<UploadResult> {
  const { userhash, maxBytes, timeoutMs = 170_000, signal } = opts
  if (!userhash || !/^[A-Za-z0-9]{1,128}$/.test(userhash)) {
    throw new Error('CATBOX_USERHASH غير صالح أو غير مضبوط على الخادم.')
  }
  const ext = path.extname(filePath).slice(1).toLowerCase()
  if (!['mp3', 'mp4'].includes(ext)) throw new Error('لا يُرفع إلا MP3 أو MP4.')
  const stat = fs.statSync(filePath)
  if (!stat.isFile() || stat.size < 12 || stat.size > maxBytes) {
    throw new Error('ملف فارغ أو يتجاوز حد الحجم.')
  }

  const boundary = `----ELMINYAWE-${crypto.randomBytes(16).toString('hex')}`
  const field = (name: string, value: string) =>
    `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
  const prefix = Buffer.from(
    field('reqtype', 'fileupload') +
      field('userhash', userhash) +
      `--${boundary}\r\nContent-Disposition: form-data; name="fileToUpload"; filename="ELMINYAWE.${ext}"\r\n` +
      `Content-Type: ${ext === 'mp3' ? 'audio/mpeg' : 'video/mp4'}\r\n\r\n`
  )
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`)

  async function* body() {
    yield prefix
    yield* fs.createReadStream(filePath)
    yield suffix
  }

  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const abortSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(prefix.length + stat.size + suffix.length),
    },
    body: Readable.toWeb(Readable.from(body())) as ReadableStream<Uint8Array>,
    // @ts-expect-error duplex is required for streaming request bodies
    duplex: 'half',
    redirect: 'error',
    signal: abortSignal,
  })
  const text = (await res.text()).trim()
  if (res.status === 412 || /^Invalid uploader/i.test(text)) {
    throw new Error('Catbox رفضت رفع هذا الخادم: HTTP 412 / Invalid uploader.')
  }
  /* Egress flakiness can truncate leading chars off tiny API responses
   * ("ttps://…") — repair the obvious case before parsing. */
  const repaired = text.startsWith('ttps://') ? `h${text}` : text
  const file = catboxFile(repaired, ext)
  if (!res.ok || !file) {
    /* HTTP 200 + empty body: the upload REQUEST usually landed, but the
     * response (which carries the new URL) was swallowed in transit — a
     * retry re-uploads the same bytes (Catbox content-dedupes → same key)
     * and typically recovers the URL on the next attempt. */
    const empty = res.ok && !repaired
    throw new Error(
      empty
        ? `استجابة Catbox وصلت فارغة (الرابط لم يعد من الشبكة) — سيعاد الرفع`
        : `فشل رفع Catbox (HTTP ${res.status}): ${parseApiText(repaired, userhash)}`
    )
  }
  return { url: file.url, id: file.id, ext }
}

/**
 * Delete remote objects from the owner's Catbox account.
 * `files` are FILENAMES (e.g. "ab12cd.mp3") — per the official API the
 * list is SPACE-separated inside one multipart field. Requires the
 * userhash (account files only); best-effort by design.
 */
export async function deleteCatboxFiles(
  files: string[],
  opts: { userhash?: string; timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<{ ok: boolean; status: number | null; error: string | null }> {
  const { userhash, timeoutMs = 20_000, signal } = opts
  if (!files.length) return { ok: true, status: null, error: null }
  if (!userhash || !/^[A-Za-z0-9]{1,128}$/.test(userhash)) {
    return { ok: false, status: null, error: 'CATBOX_USERHASH غير مضبوط.' }
  }
  try {
    const form = new FormData()
    form.append('reqtype', 'deletefiles')
    form.append('userhash', userhash)
    form.append('files', files.join(' '))
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const abortSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
    const res = await fetch(API_URL, {
      method: 'POST',
      body: form,
      redirect: 'error',
      signal: abortSignal,
    })
    const text = (await res.text()).trim()
    if (!res.ok) {
      return { ok: false, status: res.status, error: parseApiText(text, userhash) }
    }
    return { ok: true, status: res.status, error: null }
  } catch (err) {
    return { ok: false, status: null, error: String((err as Error).message || err).slice(0, 120) }
  }
}

export interface ProbeResult {
  ok: boolean
  status: number | null
  signatureValid: boolean
  error: string | null
}

/** A successful upload response is not proof of playback — fetch real bytes. */
export async function probeCatboxObject(
  url: string,
  ext: string,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<ProbeResult> {
  const { timeoutMs = 15_000, signal } = opts
  if (!catboxFile(url, ext)) throw new Error('رابط Catbox غير صالح للفحص.')
  let status: number | null = null
  let signatureValid = false
  let error: string | null = null
  try {
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const abortSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
    const res = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      headers: { Range: 'bytes=0-15', 'User-Agent': 'Mozilla/5.0' },
      redirect: 'manual',
      signal: abortSignal,
    })
    status = res.status
    if (status === 200 || status === 206) {
      if (res.body) {
        const reader = res.body.getReader()
        let first = Buffer.alloc(0)
        try {
          while (first.length < 16) {
            const { done, value } = await reader.read()
            if (done) break
            first = Buffer.concat([first, Buffer.from(value).subarray(0, 16 - first.length)])
          }
        } finally {
          await reader.cancel().catch(() => {})
        }
        signatureValid =
          ext === 'mp3'
            ? first.toString('ascii', 0, 3) === 'ID3' || (first[0] === 0xff && (first[1] & 0xe0) === 0xe0)
            : ['ftyp', 'styp'].includes(first.toString('ascii', 4, 8))
      }
    } else {
      await res.body?.cancel().catch(() => {})
      error = `HTTP ${status}`
    }
  } catch (err) {
    error = String((err as Error).message || err).slice(0, 120)
  }
  return { ok: (status === 200 || status === 206) && signatureValid, status, signatureValid, error }
}

/* ---------------------------------------------------- document store API */

/** Any files.catbox.moe object URL (not just media). */
const OBJECT_RE = /^https:\/\/files\.catbox\.moe\/([a-z0-9]{1,32})\.([a-z0-9]{1,8})$/i

export interface CatboxObject {
  id: string
  ext: string
  url: string
}

export function parseCatboxObject(url: string): CatboxObject | null {
  const m = OBJECT_RE.exec(url.trim())
  return m ? { id: m[1]!, ext: m[2]!, url: m[0]! } : null
}

/**
 * Upload a small TEXT document (the records JSON) to the owner's account.
 * Returns the new object URL — catbox assigns a fresh id per content, so
 * every distinct revision becomes its own permanent file (account uploads
 * never expire, per the FAQ).
 *
 * STREAMING NOTE — verified live (2026-10-21): this environment's egress
 * mangles single-buffer multipart bodies (files land as 0 bytes) while the
 * EXACT pattern used by uploadCatbox — a real temp file streamed with
 * duplex:'half' + explicit Content-Length — went through byte-real (a
 * 781KB MP3 upload round-tripped with a valid ID3 header). The document
 * therefore takes the same disk-stream path even though it is tiny: the
 * temp-file dance is negligible cost for a small JSON and it inherits the
 * proven transport.
 */
export async function uploadCatboxDocument(
  filename: string,
  content: string,
  opts: { userhash: string; timeoutMs?: number; signal?: AbortSignal }
): Promise<CatboxObject> {
  const { userhash, timeoutMs = 20_000, signal } = opts
  if (!userhash || !/^[A-Za-z0-9]{1,128}$/.test(userhash)) {
    throw new Error('CATBOX_USERHASH غير صالح أو غير مضبوط على الخادم.')
  }
  const body = Buffer.from(content, 'utf8')
  if (!body.length || body.length > 2_000_000) {
    throw new Error('مستند السجلات فارغ أو يتجاوز الحد.')
  }

  /* Materialise to a temp file, then stream it exactly like uploadCatbox. */
  const tmpPath = path.join(fs.realpathSync(os.tmpdir()), `elminyawe-doc-${crypto.randomBytes(6).toString('hex')}.json`)
  fs.writeFileSync(tmpPath, body)
  try {
    const stat = fs.statSync(tmpPath)
    const boundary = `----ELMINYAWE-${crypto.randomBytes(16).toString('hex')}`
    const field = (name: string, value: string) =>
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
    const prefix = Buffer.from(
      field('reqtype', 'fileupload') +
        field('userhash', userhash) +
        `--${boundary}\r\nContent-Disposition: form-data; name="fileToUpload"; filename="${filename}"\r\n` +
        `Content-Type: application/json\r\n\r\n`
    )
    const suffix = Buffer.from(`\r\n--${boundary}--\r\n`)

    async function* bodyParts() {
      yield prefix
      yield* fs.createReadStream(tmpPath)
      yield suffix
    }

    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const abortSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': String(prefix.length + stat.size + suffix.length),
      },
      body: Readable.toWeb(Readable.from(bodyParts())) as ReadableStream<Uint8Array>,
      // @ts-expect-error duplex is required for streaming request bodies
      duplex: 'half',
      redirect: 'error',
      signal: abortSignal,
    })
    const text = (await res.text()).trim()
    /* Egress flakiness can truncate leading chars off tiny API responses
     * ("ttps://…") — repair the obvious case before parsing. */
    const repaired = text.startsWith('ttps://') ? `h${text}` : text
    const obj = parseCatboxObject(repaired)
    if (!res.ok || !obj) {
      throw new Error(`فشل رفع مستند Catbox (HTTP ${res.status}): ${parseApiText(text, userhash) || 'استجابة فارغة'}`)
    }
    return obj
  } finally {
    try {
      fs.rmSync(tmpPath, { force: true })
    } catch {
      /* ignore */
    }
  }
}

/**
 * Read a small text document back from files.catbox.moe.
 *
 * RANGE-FIRST STRATEGY — verified live against the real network:
 * some egress filters (this dev sandbox included) empty plain GET bodies
 * and zero-out HEAD content-lengths for files.catbox.moe, while Range
 * requests stream REAL bytes untouched. Players and our byte-proxy always
 * use Range anyway, so the records reader does the same: try a Range GET
 * first (0..maxBytes-1), fall back to a plain GET. On Vercel both work.
 */
export async function fetchCatboxDocumentText(
  url: string,
  opts: { timeoutMs?: number; maxBytes?: number; signal?: AbortSignal } = {}
): Promise<string> {
  const { timeoutMs = 12_000, maxBytes = 2_000_000, signal } = opts
  const obj = parseCatboxObject(url)
  if (!obj) throw new Error('رابط مستند Catbox غير صالح.')
  const attempt = async (headers: Record<string, string>): Promise<{ status: number; text: string }> => {
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const abortSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', ...headers },
      cache: 'no-store',
      redirect: 'error',
      signal: abortSignal,
    })
    const text = await res.text()
    return { status: res.status, text }
  }
  /* 1) Range GET — passes egress filters and is what players use. */
  try {
    const r = await attempt({ Range: `bytes=0-${maxBytes - 1}` })
    if ((r.status === 200 || r.status === 206) && r.text.trim()) return r.text
  } catch {
    /* fall through to the plain GET */
  }
  /* 2) Plain GET — the normal path on Vercel/self-host. */
  const r = await attempt({})
  if (r.status !== 200) throw new Error(`تعذّرت قراءة المستند (HTTP ${r.status}).`)
  return r.text
}

/* ------------------------------------------------------------ album API */

export interface AlbumPointer {
  id: string
  ext: string
}

/**
 * List the files an album currently holds. The album page HTML carries a
 * hidden `.imagelist` block with plain object URLs — tiny and stable to
 * parse. The records album is edited only through editalbum (which
 * REPLACES the whole list), so it contains exactly ONE file by design.
 */
export async function catboxAlbumFiles(
  short: string,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<AlbumPointer[]> {
  const { timeoutMs = 10_000, signal } = opts
  if (!/^[a-z0-9]{4,16}$/i.test(short)) throw new Error('معرّف ألبوم Catbox غير صالح.')
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const abortSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
  const res = await fetch(`https://catbox.moe/c/${short}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
    cache: 'no-store',
    redirect: 'error',
    signal: abortSignal,
  })
  if (!res.ok) throw new Error(`تعذّرت قراءة صفحة الألبوم (HTTP ${res.status}).`)
  const html = await res.text()
  const seen = new Set<string>()
  const out: AlbumPointer[] = []
  const re = /https:\/\/files\.catbox\.moe\/([a-z0-9]{1,32})\.([a-z0-9]{1,8})/g
  for (const m of html.matchAll(re)) {
    const key = `${m[1]}.${m[2]}`
    if (!seen.has(key)) {
      seen.add(key)
      out.push({ id: m[1]!, ext: m[2]! })
    }
  }
  return out
}

/**
 * REPLACE the album's file list (official editalbum semantics — every
 * argument must be supplied, files are single-space-separated ids).
 * The response body is not trusted (some proxies mangle small API bodies);
 * success is confirmed by re-reading the album page when verify=true.
 */
export async function catboxAlbumEdit(
  short: string,
  files: string[],
  opts: { userhash: string; title: string; desc: string; timeoutMs?: number; signal?: AbortSignal }
): Promise<{ ok: boolean; status: number | null; error: string | null }> {
  const { userhash, title, desc, timeoutMs = 15_000, signal } = opts
  if (!userhash || !/^[A-Za-z0-9]{1,128}$/.test(userhash)) {
    return { ok: false, status: null, error: 'CATBOX_USERHASH غير مضبوط.' }
  }
  try {
    const form = new FormData()
    form.append('reqtype', 'editalbum')
    form.append('userhash', userhash)
    form.append('short', short)
    form.append('title', title)
    form.append('desc', desc)
    form.append('files', files.join(' '))
    const timeoutSignal = AbortSignal.timeout(timeoutMs)
    const abortSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
    const res = await fetch(API_URL, {
      method: 'POST',
      body: form,
      redirect: 'error',
      signal: abortSignal,
    })
    if (!res.ok) {
      const text = (await res.text()).trim()
      return { ok: false, status: res.status, error: parseApiText(text, userhash) || `HTTP ${res.status}` }
    }
    return { ok: true, status: res.status, error: null }
  } catch (err) {
    return { ok: false, status: null, error: String((err as Error).message || err).slice(0, 140) }
  }
}

/* --------------------------------------------------------- reachability */

/**
 * Reachability probe for the Catbox API (used for status displays).
 *
 * Stale-while-revalidate with TTL cache — Catbox HEAD probes hang
 * intermittently from some networks (undici reusing dead keep-alive
 * sockets: 6s stalls). Semantics:
 *   - First ever call: waits for the probe (one-time cost).
 *   - Later calls: return the cached value instantly even when expired
 *     and refresh it in the background — health checks never block.
 *   - Successes are trusted for 5 minutes; failures revalidate after 2.
 * NOTE (v5.4): conversions no longer gate on this — the upload path has
 * its own retries, so a stale "unreachable" value can never prevent a
 * durable Catbox save. This stays purely informational.
 */
let reachCache: { value: boolean; at: number } | null = null
let probing: Promise<boolean> | null = null
const REACH_TTL_OK = 300_000
const REACH_TTL_FAIL = 120_000

async function probeReach(timeoutMs: number): Promise<boolean> {
  try {
    const res = await fetch(API_URL, {
      method: 'HEAD',
      signal: AbortSignal.timeout(timeoutMs),
    })
    return res.status < 500
  } catch {
    return false
  }
}

function startProbe(timeoutMs: number): Promise<boolean> {
  if (!probing) {
    probing = probeReach(timeoutMs)
      .then((value) => {
        reachCache = { value, at: Date.now() }
        return value
      })
      .finally(() => {
        probing = null
      })
  }
  return probing
}

export async function catboxReachable(timeoutMs = 5_000, opts?: { wait?: boolean }): Promise<boolean> {
  if (reachCache) {
    const ttl = reachCache.value ? REACH_TTL_OK : REACH_TTL_FAIL
    if (Date.now() - reachCache.at < ttl) return reachCache.value
    /* Expired: serve stale + revalidate in the background. */
    if (!opts?.wait) {
      void startProbe(timeoutMs)
      return reachCache.value
    }
  }
  /* No cached value yet — the caller must wait for the first probe. */
  return startProbe(timeoutMs)
}

/* ------------------------------------------------------------ self-test */

/**
 * Generate a tiny but REAL MP3 (ID3v2 header + one silent MPEG frame) for
 * the admin live Catbox roundtrip. It passes every local guard:
 * assertMediaFile (size + magic bytes) and probeCatboxObject (signature).
 */
export function makeProbeMp3(destPath: string): string {
  const id3Header = Buffer.from([
    0x49, 0x44, 0x33, 0x03, 0x00, 0x00, // "ID3" v2.3, no flags
    0x00, 0x00, 0x00, 0x24, // tag size (syncsafe) = 36 bytes
  ])
  const frame = Buffer.concat([
    Buffer.from('TIT2', 'ascii'), // title frame
    Buffer.from([0x00, 0x00, 0x00, 0x1a]), // size 26, no flags
    Buffer.from([0x00]), // ISO-8859-1 encoding
    Buffer.from('ELMINYAWE storage probe', 'ascii'),
  ])
  // One silent 128kbps/44.1kHz MPEG-1 Layer III frame (417 bytes, sync 0xFF 0xFB).
  const mpeg = Buffer.alloc(417)
  mpeg[0] = 0xff
  mpeg[1] = 0xfb
  mpeg[2] = 0x90
  mpeg[3] = 0x00
  const file = Buffer.concat([id3Header, frame, mpeg])
  fs.writeFileSync(destPath, file)
  return destPath
}
