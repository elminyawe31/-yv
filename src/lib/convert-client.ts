"use client"

/**
 * Shared client-side conversion stream runner.
 * Used by both the single-conversion flow and the batch queue.
 */

import { engineDisplayName, type Lang } from "@/lib/i18n"

export interface VideoInfo {
  id: string
  title: string
  channel: string
  duration: number
  durationString: string
  description: string
  thumbnail: string | null
  tooLong: boolean
}

export interface ConversionEvent {
  stage:
    | "resolve"
    | "download"
    | "convert"
    | "upload"
    | "verify"
    | "store"
    | "done"
    | "error"
    | "engine"
    | "engine-skip"
  percent?: number
  message?: string
  /** English variant of the message (bilingual terminal). */
  en?: string
  engine?: string
  engineLabel?: string
  reason?: string
  status?: "start" | "ok" | "fail" | "skip"
}

export interface ConvertResult {
  ok: true
  type: "mp3" | "mp4"
  title: string
  sizeMB: number
  qualityRequested: string
  quality: string
  engine: string
  engineLabel: string
  storage: "catbox" | "local" | "blob"
  directUrl: string
  directPath: string
  thumbnail?: string | null
  /** Source video id — used for cover-art download in the UI. */
  videoId?: string
}

/** Pick the localized variant of a streamed message. */
export function eventMessage(event: { message?: string; en?: string }, lang: Lang): string {
  return lang === "en" && event.en ? event.en : event.message || ""
}

/** Generic engine display name («المحرك 1» / «Engine 1»). */
export function engineName(id?: string, lang: Lang = "ar"): string {
  return engineDisplayName(id, lang)
}

export interface StreamHandlers {
  onEvent?: (event: ConversionEvent) => void
  onPercent?: (percent: number) => void
  onEngine?: (engine: string | null) => void
}

export interface StreamOptions {
  url: string
  type: "mp3" | "mp4"
  quality: string
  /** UI language — streamed error messages come back localized. */
  lang?: Lang
  /** Optional clip range in seconds (start inclusive, end exclusive). */
  trim?: { start: number; end: number } | null
  /** Channel name embedded as the ID3/MP4 artist tag when possible. */
  artist?: string
  signal?: AbortSignal
}

/** Runs a conversion and streams NDJSON events. Resolves with the result. */
export async function runConvertStream(
  { url, type, quality, trim, artist, lang, signal }: StreamOptions,
  handlers: StreamHandlers = {},
): Promise<ConvertResult> {
  const res = await fetch("/api/convert", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      type,
      quality,
      lang,
      ...(trim ? { trim: { start: trim.start, end: trim.end } } : {}),
      ...(artist ? { artist } : {}),
    }),
    signal,
  })

  const contentType = res.headers.get("content-type") || ""
  if (!contentType.includes("ndjson")) {
    const data = await res.json().catch(() => null)
    throw new Error(
      (lang === "en" && data?.errorEn) || data?.error || `Unexpected server response (HTTP ${res.status}).`
    )
  }

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  let finished = false

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split("\n")
    buffer = parts.pop() || ""
    for (const part of parts) {
      if (!part.trim() || finished) continue
      const event: ConversionEvent & ConvertResult & { ok?: boolean; error?: string; errorEn?: string } = JSON.parse(part)
      if (event.stage) {
        handlers.onEvent?.(event)
        if (event.stage === "engine" && typeof event.engine === "string") {
          handlers.onEngine?.(event.status === "fail" ? null : engineName(event.engine, lang))
        }
        if (typeof event.percent === "number") handlers.onPercent?.(event.percent)
      }
      if (event.ok === true && event.directUrl) {
        finished = true
        return event
      }
      if (event.ok === false) {
        finished = true
        throw new Error(
          (lang === "en" && event.errorEn) || event.error ||
            (lang === "en" ? "Conversion failed." : "تعذّر التحويل.")
        )
      }
    }
  }

  throw new Error(lang === "en" ? "The conversion stream ended before completion." : "انقطع بث التحويل قبل اكتماله.")
}

/** Fetch video metadata (used by the batch queue to enrich items). */
export async function fetchVideoInfo(url: string): Promise<VideoInfo> {
  const res = await fetch("/api/info", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  })
  const data = await res.json()
  if (!data.ok) throw new Error(data.error || "تعذّر التعرف على الفيديو.")
  return data.info as VideoInfo
}

export interface PlaylistEntry {
  id: string
  title: string
  durationString: string
  thumbnail: string
}

export interface PlaylistData {
  ok: true
  playlistId: string
  title: string
  total: number
  returned: number
  items: PlaylistEntry[]
}

/** Fetch the entries of a YouTube playlist (any URL form carrying list=). */
export async function fetchPlaylist(url: string): Promise<PlaylistData> {
  const res = await fetch("/api/playlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  })
  const data = await res.json()
  if (!data.ok) throw new Error(data.error || "تعذّر جلب القائمة.")
  return data as PlaylistData
}
