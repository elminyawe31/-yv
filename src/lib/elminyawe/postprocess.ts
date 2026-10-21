import fs from 'node:fs'
import path from 'node:path'
import { run } from './runner'
import { resolveFfmpeg, type MediaExt } from './brand'

/* ============================================================
 *  Post-processing: clip trimming + ID3 metadata embedding
 *  Runs on the provider output inside the work dir, before
 *  the file is saved to storage. Uses stream copy first for
 *  speed, falling back to a re-encode when copy cuts nothing.
 * ============================================================ */

export interface TrimRange {
  start: number
  end: number
}

export interface TrimOptions {
  file: string
  ext: MediaExt
  start: number
  end: number
  workDir: string
  signal?: AbortSignal
  /** Remaining conversion budget — keeps ffmpeg inside the request deadline. */
  deadlineAt?: number
}

function ffmpegBudget(deadlineAt?: number): number {
  if (!deadlineAt) return 90_000
  return Math.max(5_000, Math.min(90_000, deadlineAt - Date.now() - 2_000))
}

function fileSize(file: string): number {
  try {
    return fs.statSync(file).size
  } catch {
    return 0
  }
}

/**
 * Cut [start, end] out of a media file.
 * Returns the path of the trimmed file (always inside workDir).
 */
export async function applyTrim(opts: TrimOptions): Promise<string> {
  const { file, ext, workDir, signal } = opts
  const start = Math.max(0, Math.floor(opts.start))
  const end = Math.max(start + 1, Math.floor(opts.end))
  const duration = end - start
  const out = path.join(workDir, `trimmed.${ext}`)
  const budget = ffmpegBudget(opts.deadlineAt)

  /* ---- 1) stream copy (fast, near-keyframe accurate) ---- */
  try {
    await run(
      resolveFfmpeg(),
      [
        '-y',
        '-hide_banner',
        '-loglevel', 'error',
        '-ss', String(start),
        '-i', file,
        '-t', String(duration),
        '-c', 'copy',
        '-avoid_negative_ts', 'make_zero',
        out,
      ],
      { timeout: budget, dir: workDir, signal },
    )
    // A successful copy that produced a real file (> 4KB) is good enough.
    if (fileSize(out) > 4096) return out
    fs.rmSync(out, { force: true })
  } catch {
    fs.rmSync(out, { force: true })
    /* fall through to re-encode */
  }

  /* ---- 2) re-encode fallback (frame accurate) ---- */
  const audioArgs = ext === 'mp3'
    ? ['-c:a', 'libmp3lame', '-b:a', '192k']
    : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart']
  await run(
    resolveFfmpeg(),
    [
      '-y',
      '-hide_banner',
      '-loglevel', 'error',
      '-ss', String(start),
      '-i', file,
      '-t', String(duration),
      ...audioArgs,
      out,
    ],
    { timeout: budget, dir: workDir, signal },
  )
  if (fileSize(out) < 1024) {
    throw new Error('تعذّر قص المقطع — نطاق زمني غير صالح.')
  }
  return out
}

export interface Id3Options {
  file: string
  title: string
  artist?: string | null
  /** Local image path (jpg/png) already downloaded to workDir. */
  cover: string | null
  workDir: string
  signal?: AbortSignal
  deadlineAt?: number
}

/**
 * Embed ID3v2 title/artist + attached cover art into an MP3.
 * Returns the new file path (container rewrite, no audio re-encode).
 */
export async function embedId3(opts: Id3Options): Promise<string> {
  const { file, title, artist, cover, workDir, signal } = opts
  const out = path.join(workDir, 'tagged.mp3')
  const budget = ffmpegBudget(opts.deadlineAt)

  const args = [
    '-y',
    '-hide_banner',
    '-loglevel', 'error',
    '-i', file,
  ]
  if (cover && fs.existsSync(cover)) {
    args.push('-i', cover)
  }
  args.push(
    '-map', '0:a',
    '-c', 'copy',
    '-id3v2_version', '3',
    '-write_id3v1', '1',
    '-metadata', `title=${title.slice(0, 200)}`,
    '-metadata', `artist=${(artist || 'ELMINYAWE').slice(0, 120)}`,
    '-metadata', 'album=ELMINYAWE',
    '-metadata', 'encoded_by=ELMINYAWE Media Studio',
  )
  if (cover && fs.existsSync(cover)) {
    args.push(
      '-map', '1:v',
      '-c:v', 'copy',
      '-metadata:s:v', 'title=Album cover',
      '-metadata:s:v', 'comment=Cover (front)',
      '-disposition:v', 'attached_pic',
    )
  }
  args.push(out)

  try {
    await run(resolveFfmpeg(), args, { timeout: budget, dir: workDir, signal })
  } catch {
    fs.rmSync(out, { force: true })
    /* Metadata is a nicety — never fail the conversion for it. */
    return file
  }
  // Guard: a broken container rewrite must not destroy the audio.
  if (fileSize(out) < fileSize(file) * 0.95) {
    fs.rmSync(out, { force: true })
    return file
  }
  return out
}

export interface Mp4TagOptions {
  file: string
  title: string
  artist?: string | null
  workDir: string
  signal?: AbortSignal
  deadlineAt?: number
}

/**
 * Embed title/artist/comment metadata into an MP4 (iTunes-style atoms)
 * via a stream-copy remux with faststart. No re-encode, near-instant.
 * Returns the new file path, or the original on any failure.
 */
export async function embedMp4Tags(opts: Mp4TagOptions): Promise<string> {
  const { file, title, artist, workDir, signal } = opts
  const out = path.join(workDir, 'tagged.mp4')
  const budget = ffmpegBudget(opts.deadlineAt)

  try {
    await run(
      resolveFfmpeg(),
      [
        '-y',
        '-hide_banner',
        '-loglevel', 'error',
        '-i', file,
        '-map', '0',
        '-c', 'copy',
        '-movflags', '+faststart',
        '-map_metadata', '-1',
        '-metadata', `title=${title.slice(0, 200)}`,
        '-metadata', `artist=${(artist || 'ELMINYAWE').slice(0, 120)}`,
        '-metadata', 'album=ELMINYAWE',
        '-metadata', 'comment=Converted by ELMINYAWE Media Studio',
        '-metadata', 'encoded_by=ELMINYAWE Media Studio',
        out,
      ],
      { timeout: budget, dir: workDir, signal },
    )
  } catch {
    fs.rmSync(out, { force: true })
    /* metadata is a nicety — never fail the conversion for it */
    return file
  }
  // Guard: a broken remux must not destroy the media.
  if (fileSize(out) < fileSize(file) * 0.95) {
    fs.rmSync(out, { force: true })
    return file
  }
  return out
}

/** Download the YouTube thumbnail to workDir for cover embedding. */
export async function downloadCover(
  videoId: string,
  workDir: string,
  signal?: AbortSignal,
): Promise<string | null> {
  for (const quality of ['maxresdefault', 'hqdefault']) {
    try {
      const res = await fetch(`https://i.ytimg.com/vi/${videoId}/${quality}.jpg`, {
        signal: signal ?? AbortSignal.timeout(8_000),
      })
      if (!res.ok) continue
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.length < 2048) continue // grey placeholder guard
      const p = path.join(workDir, `cover-${quality}.jpg`)
      fs.writeFileSync(p, buf)
      return p
    } catch {
      /* try the next quality */
    }
  }
  return null
}

/* ============================================================
 *  Compress-to-fit: when a provider delivers a file larger than
 *  the platform limit (e.g. ytmp3.gl always returns its default
 *  720p MP4 regardless of the requested quality), re-encode it
 *  locally with ffmpeg at a computed bitrate so it fits.
 * ============================================================ */

export interface CompressToFitOptions {
  file: string
  ext: MediaExt
  /** Hard ceiling for the final file (bytes). */
  maxBytes: number
  workDir: string
  signal?: AbortSignal
  deadlineAt?: number
  /** Progress reporter (0-100 within the compress phase). */
  onProgress?: (stageMessage: string) => void
}

/** Read the exact duration (seconds) of a media file via ffprobe. */
async function probeDuration(file: string): Promise<number> {
  try {
    const { stdout } = await run(
      'ffprobe',
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
      { timeout: 20_000 },
    )
    const d = Number(stdout.trim())
    return Number.isFinite(d) && d > 0 ? d : 0
  } catch {
    return 0
  }
}

function fmtKBps(bitsPerSecond: number): string {
  /* ffmpeg parses bare numbers as bits/sec — always emit the kbps suffix. */
  return `${Math.max(1, Math.round(bitsPerSecond / 1000))}k`
}

/**
 * Re-encode `file` so the result stays under `maxBytes`.
 * Returns the new file path; throws when even the minimum viable
 * bitrate cannot fit the limit.
 */
export async function compressToFit(opts: CompressToFitOptions): Promise<string> {
  const { file, ext, maxBytes, workDir, signal } = opts
  const duration = await probeDuration(file)
  if (duration <= 0) {
    throw new Error('تعذّر قياس مدة الملف لإعادة ضغطه.')
  }

  /* Total average bitrate the container may carry (bits/sec), with a 4%
   * safety margin for container overhead. */
  const totalBps = (maxBytes * 8 * 0.96) / duration

  const out = path.join(workDir, `fitted.${ext}`)
  /* Compression may legitimately need longer than the trim budget — allow
   * up to 150s while still respecting the request deadline. */
  const budget = Math.max(
    5_000,
    Math.min(150_000, opts.deadlineAt ? opts.deadlineAt - Date.now() - 2_000 : 150_000),
  )

  if (ext === 'mp3') {
    /* Audio-only: 64kbps is the practical floor for music. */
    const audioKbps = Math.floor(totalBps / 1000)
    if (audioKbps < 64) {
      throw new Error('الملف طويل جدًا حتى بعد الضغط — جرّب قص المقطع أولًا.')
    }
    await run(
      resolveFfmpeg(),
      [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-i', file,
        '-c:a', 'libmp3lame', '-b:a', `${Math.min(320, audioKbps)}k`,
        out,
      ],
      { timeout: budget, dir: workDir, signal },
    )
  } else {
    /* Video: allocate ~128kbps to AAC audio, the rest to H.264. Resolution
     * follows the bitrate budget (lower res also encodes much faster) and the
     * ultrafast preset keeps us inside the request deadline — with a fixed
     * target bitrate the preset only trades CPU time, not final size. */
    const AUDIO_BPS = 128_000
    const videoBps = totalBps - AUDIO_BPS
    if (videoBps < 80_000) {
      throw new Error('الفيديو طويل جدًا حتى بعد الضغط — جرّب جودة أقل أو صيغة MP3.')
    }
    const maxHeight = videoBps < 600_000 ? 360 : videoBps < 1_200_000 ? 480 : 720
    await run(
      resolveFfmpeg(),
      [
        '-y', '-hide_banner', '-loglevel', 'error',
        '-i', file,
        '-vf', `scale=-2:min(${maxHeight}\\,ih)`,
        '-c:v', 'libx264', '-preset', 'ultrafast',
        '-b:v', fmtKBps(videoBps), '-maxrate', fmtKBps(videoBps * 1.45), '-bufsize', fmtKBps(videoBps * 2.9),
        '-c:a', 'aac', '-b:a', '128k',
        '-movflags', '+faststart',
        out,
      ],
      { timeout: budget, dir: workDir, signal },
    )
  }

  const fitted = fileSize(out)
  if (fitted < 1024) {
    fs.rmSync(out, { force: true })
    throw new Error('فشلت إعادة الضغط — لم ينتج ffmpeg ملفًا صالحًا.')
  }
  if (fitted > maxBytes) {
    fs.rmSync(out, { force: true })
    throw new Error('تعذّر ضغط الملف تحت الحد الأقصى — اختر جودة أقل.')
  }
  return out
}
