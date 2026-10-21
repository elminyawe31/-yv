import fs from 'node:fs'
import path from 'node:path'
import { saveMedia, brandedPathForKey } from './storage'
import { BRAND, CONVERSION_DEADLINE_MS, HOBBY_TIMEOUT_MESSAGE, MAX_FILE_MB, QUALITY_CHOICES, type MediaExt } from './brand'
import { providerChain, makeWorkDir, cleanupWorkDir } from './providers'
import { applyTrim, embedId3, embedMp4Tags, downloadCover, type TrimRange } from './postprocess'
import type { ParsedVideo } from './youtube'
import type { DownloadProvider } from './providers'

export interface ConversionEvent {
  stage:
    | 'resolve'
    | 'download'
    | 'convert'
    | 'upload'
    | 'verify'
    | 'store'
    | 'done'
    | 'error'
    | 'engine'
    | 'engine-skip'
  percent?: number
  message?: string
  /** English variant of the message for the bilingual terminal. */
  en?: string
  /** Engine id (ytmp3gl | marisa | ytdlp). */
  engine?: string
  /** Engine display label. */
  engineLabel?: string
  /** Why an engine was skipped. */
  reason?: string
  status?: 'start' | 'ok' | 'fail' | 'skip'
}

export interface ConversionResult {
  ok: true
  brand: string
  type: MediaExt
  title: string
  size: number
  sizeMB: number
  qualityRequested: string
  quality: string
  engine: string
  engineLabel: string
  storage: 'catbox' | 'local' | 'blob'
  fileKey: string
  directPath: string
  directUrl: string
  createdAt: string
  /** Source video id — used for cover-art download in the UI. */
  videoId: string
  /** hq thumbnail URL for the audio-player backdrop. */
  thumbnail: string
}

function remainingTime(deadlineAt: number, signal?: AbortSignal): number {
  if (signal?.aborted) throw new Error('أُلغِيَ التحويل بعد إغلاق الطلب.')
  const time = deadlineAt - Date.now()
  if (time < 1000) throw new Error(HOBBY_TIMEOUT_MESSAGE)
  return time
}

/** Global concurrency guard (per-instance, like the original design). */
let activeConversions = 0
export function getActiveConversions(): number {
  return activeConversions
}
export function reserveConversionSlot(): boolean {
  return activeConversions < 1 ? ((activeConversions++), true) : false
}
export function releaseConversionSlot(): void {
  activeConversions = Math.max(0, activeConversions - 1)
}

export interface ConvertParams {
  video: ParsedVideo
  ext: MediaExt
  quality: string
  baseUrl: string
  signal?: AbortSignal
  onEvent?: (event: ConversionEvent) => void
  /** Optional clip extraction window (seconds). */
  trim?: TrimRange
  /** Channel/author for MP3 ID3 embedding. */
  artist?: string
}

export function publicError(err: unknown, lang: 'ar' | 'en' = 'ar'): string {
  const raw = String((err as Error)?.message || err)
  console.warn('[conversion]', raw)
  const isEn = lang === 'en'
  if (/أُلغِيَ/.test(raw)) {
    return isEn ? 'The request was cancelled.' : raw
  }
  if (raw.includes('انتهت مهلة التحويل') || /ETIMEDOUT|timed out|timeout|Timeout|انتهت مهلة/i.test(raw)) {
    return isEn
      ? 'The conversion timed out. Try a shorter clip or a lower quality.'
      : HOBBY_TIMEOUT_MESSAGE
  }
  /* Size-limit is the most actionable failure — surface it instead of the
   * generic bot-check text when any engine reported it. */
  if (raw.includes('تجاوز الملف الحد الأقصى')) {
    return isEn
      ? `The output file exceeded the ${MAX_FILE_MB}MB limit — pick a lower quality or MP3.`
      : `تجاوز الملف الناتج الحد الأقصى (${MAX_FILE_MB}MB) — اختر جودة أقل أو صيغة MP3 لإتمام التحويل.`
  }
  if (/Sign in to confirm|bot/i.test(raw)) {
    return isEn
      ? 'YouTube is requiring verification for this video. Try another video or retry in a few minutes.'
      : 'تعذّر التحويل: يطلب يوتيوب التحقق لهذا الفيديو. جرّب فيديو آخر أو أعد المحاولة بعد قليل.'
  }
  if (raw.includes('فشلت جميع المحركات')) {
    return isEn
      ? 'Conversion failed on all available engines. Try a different quality or another video.'
      : 'فشل التحويل عبر جميع المحركات المتاحة. جرّب جودة مختلفة أو فيديو آخر.'
  }
  if (raw.includes('لا توجد محركات')) {
    return isEn
      ? 'No conversion engines are currently available. Please try again later.'
      : 'لا توجد محركات تحويل متاحة حاليًا على الخادم. حاول لاحقًا.'
  }
  if (/HTTP 412|Invalid uploader/.test(raw)) {
    return isEn
      ? 'Could not store the file — please try again.'
      : 'تعذّر تخزين الملف الناتج — أعد المحاولة.'
  }
  /* Unknown errors: never leak internal details to the public site. */
  return isEn ? 'Conversion failed. Please try again.' : 'تعذّر التحويل. حاول مرة أخرى.'
}

interface AttemptOutcome {
  provider: DownloadProvider
  file: string
  title: string
  quality: string
}

/** Try every engine in order until one produces a file. */
async function acquireMedia(
  params: ConvertParams,
  deadlineAt: number,
  workDir: string
): Promise<AttemptOutcome> {
  const emit = params.onEvent ?? (() => {})
  const chain = providerChain()
  const failures: string[] = []

  for (const provider of chain) {
    remainingTime(deadlineAt, params.signal)
    try {
      const reason = await provider.unavailableReason()
      if (reason) {
        emit({
          stage: 'engine-skip',
          engine: provider.id,
          engineLabel: provider.label,
          reason,
          status: 'skip',
        })
        continue
      }
    } catch (err) {
      emit({
        stage: 'engine-skip',
        engine: provider.id,
        engineLabel: provider.label,
        reason: String((err as Error).message || err).slice(0, 140),
        status: 'skip',
      })
      continue
    }

    emit({ stage: 'engine', engine: provider.id, engineLabel: provider.label, status: 'start' })
    try {
      const out = await provider.convert({
        videoId: params.video.id,
        videoUrl: params.video.url,
        ext: params.ext,
        quality: params.quality,
        workDir,
        deadlineAt,
        signal: params.signal,
        onEvent: (event) =>
          emit({
            stage: event.stage,
            percent: event.percent,
            message: event.message,
            en: event.en,
            engine: provider.id,
            engineLabel: provider.label,
          }),
      })
      emit({ stage: 'engine', engine: provider.id, engineLabel: provider.label, status: 'ok' })
      return { provider, ...out }
    } catch (err) {
      const msg = String((err as Error).message || err).slice(0, 200)
      failures.push(`${provider.label}: ${msg}`)
      emit({
        stage: 'engine',
        engine: provider.id,
        engineLabel: provider.label,
        status: 'fail',
        reason: msg,
      })
      // Clean partial outputs before the next engine reuses the same dir.
      try {
        for (const name of fs.readdirSync(workDir)) {
          if (
            name.startsWith('ytmp3gl-out.') ||
            name.startsWith('cdnframe-out.') ||
            name.startsWith('ELMINYAWE.') ||
            name.startsWith('fitted.') ||
            name.startsWith('trimmed.') ||
            name.startsWith('tagged.')
          ) {
            fs.rmSync(path.join(workDir, name), { force: true })
          }
        }
      } catch {
        /* ignore cleanup errors */
      }
    }
  }

  throw new Error(
    failures.length
      ? `فشلت جميع المحركات:\n${failures.join('\n')}`
      : 'لا توجد محركات تحويل متاحة على الخادم.'
  )
}

export async function convert(params: ConvertParams): Promise<ConversionResult> {
  const { video, ext, quality, baseUrl, signal, onEvent } = params
  const emit = onEvent ?? (() => {})
  const workDir = makeWorkDir()
  try {
    const deadlineAt = Date.now() + CONVERSION_DEADLINE_MS
    remainingTime(deadlineAt, signal)
    emit({ stage: 'resolve', message: 'تحديد أفضل محرك تحويل متاح...', en: 'Selecting the best available engine...' })

    const outcome = await acquireMedia(params, deadlineAt, workDir)

    /* ---- Optional clip trimming (user-selected range) ---- */
    let file = outcome.file
    let title = outcome.title
    if (
      params.trim &&
      Number.isFinite(params.trim.start) &&
      Number.isFinite(params.trim.end) &&
      params.trim.end - params.trim.start >= 2
    ) {
      remainingTime(deadlineAt, signal)
      emit({
        stage: 'convert',
        message: `قص المقطع المحدد (${formatClipTime(params.trim.start)} → ${formatClipTime(params.trim.end)})...`,
        en: `Trimming the selected clip (${formatClipTime(params.trim.start)} → ${formatClipTime(params.trim.end)})...`,
      })
      try {
        file = await applyTrim({
          file,
          ext,
          start: params.trim.start,
          end: params.trim.end,
          workDir,
          signal,
          deadlineAt,
        })
        title = `${title} (مقطع)`
        emit({ stage: 'convert', message: 'اكتمل قص المقطع بنجاح.', en: 'Clip trimming finished successfully.' })
      } catch (err) {
        emit({
          stage: 'error',
          message: `تعذر القص المطلوب — سيُسلّم الملف كاملًا: ${String((err as Error).message).slice(0, 80)}`,
          en: 'Trimming failed — the full file will be delivered instead.',
        })
      }
    }

    /* ---- MP3: embed ID3 title/artist + YouTube cover art ---- */
    if (ext === 'mp3') {
      remainingTime(deadlineAt, signal)
      emit({ stage: 'store', message: 'تضمين بيانات العنوان والغلاف في MP3...', en: 'Embedding title and cover art into the MP3...' })
      try {
        const cover = await downloadCover(video.id, workDir, signal)
        file = await embedId3({ file, title, artist: params.artist, cover, workDir, signal, deadlineAt })
        emit({ stage: 'store', message: 'تم تضمين البيانات والغلاف.', en: 'Metadata and cover art embedded.' })
      } catch {
        /* metadata is a nicety — never fail the conversion for it */
      }
    }

    /* ---- MP4: embed title/artist metadata (stream-copy remux) ---- */
    if (ext === 'mp4') {
      remainingTime(deadlineAt, signal)
      emit({ stage: 'store', message: 'تضمين بيانات العنوان في MP4...', en: 'Embedding title metadata into the MP4...' })
      try {
        file = await embedMp4Tags({ file, title, artist: params.artist, workDir, signal, deadlineAt })
        emit({ stage: 'store', message: 'تم تضمين بيانات MP4.', en: 'MP4 metadata embedded.' })
      } catch {
        /* metadata is a nicety — never fail the conversion for it */
      }
    }

    emit({ stage: 'store', message: 'حفظ الملف وإعداد رابط التحميل...', en: 'Saving the file and preparing the link...' })

    const stored = await saveMedia(file, ext, {
      deadlineAt,
      signal,
      onProgress: (stage, note) =>
        emit({
          stage: stage as ConversionEvent['stage'],
          ...(note ? { message: note.message, en: note.en } : {}),
        }),
    })

    const size = stored.sizeBytes
    const directPath = brandedPathForKey(stored.fileKey, ext)
    emit({ stage: 'done' })
    return {
      ok: true,
      brand: BRAND,
      type: ext,
      title,
      size,
      sizeMB: +(size / 1048576).toFixed(2),
      qualityRequested: quality,
      quality: outcome.quality,
      engine: outcome.provider.techLabel,
      engineLabel: outcome.provider.label,
      storage: stored.storage,
      fileKey: stored.fileKey,
      directPath,
      directUrl: `${baseUrl}${directPath}`,
      createdAt: new Date().toISOString(),
      videoId: video.id,
      thumbnail: `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg`,
    }
  } finally {
    cleanupWorkDir(workDir)
    releaseConversionSlot()
  }
}

/** mm:ss label for trim terminal messages. */
function formatClipTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export function validateQuality(ext: MediaExt, quality: string | undefined): string | null {
  const choices = QUALITY_CHOICES[ext] as readonly string[]
  if (!quality || quality === 'auto') return ext === 'mp3' ? '128K' : '720'
  return choices.includes(quality) ? quality : null
}
