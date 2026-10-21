import type { MediaExt } from '../brand'

/* ============================================================
 *  ELMINYAWE multi-provider download engine
 *  Providers are pluggable backends that resolve a YouTube
 *  video into a local media file. The conversion pipeline
 *  tries them in order and fails over automatically.
 * ============================================================ */

export type EngineId = 'ytmp3gl' | 'marisa' | 'ytdlp'

export interface ProviderEvent {
  stage: 'resolve' | 'download' | 'convert' | 'done'
  percent?: number
  message?: string
  /** English variant of the message for the bilingual terminal. */
  en?: string
}

export interface ConvertContext {
  /** YouTube video id (11 chars). */
  videoId: string
  /** Canonical YouTube watch URL. */
  videoUrl: string
  ext: MediaExt
  /** Requested quality, e.g. '128K' | '320K' | '720' | '1080'. */
  quality: string
  /** Scratch directory the provider must write its output into. */
  workDir: string
  /** Absolute deadline (Date.now() based). */
  deadlineAt: number
  signal?: AbortSignal
  onEvent: (event: ProviderEvent) => void
}

export interface ProviderFile {
  /** Absolute path of the produced media file (must live inside workDir). */
  file: string
  /** Best-effort video title. */
  title: string
  /** Quality actually delivered (may differ from the request). */
  quality: string
}

export interface DownloadProvider {
  id: EngineId
  /** Human label shown in the live terminal (Arabic). */
  label: string
  /** Short Latin label used in badges/history. */
  techLabel: string
  kind: 'api' | 'local'
  /**
   * Cheap availability probe. When it returns a string, the provider is
   * skipped during failover and the string explains why.
   */
  unavailableReason(): Promise<string | null> | string | null
  /** Run the conversion and produce a file inside ctx.workDir. */
  convert(ctx: ConvertContext): Promise<ProviderFile>
}

export interface VideoInfoResult {
  title: string
  duration: number
  channel?: string
  description?: string
  /** Qualities actually offered by this provider. */
  audioQualities?: number[]
  videoQualities?: number[]
}
