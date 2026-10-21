import type { NextRequest } from 'next/server'

/** Fixed-window in-memory rate limiter (per server process). */

interface Bucket {
  count: number
  resetAt: number
}

const buckets = new Map<string, Bucket>()

export function clientKey(req: NextRequest): string {
  const ip =
    req.headers.get('x-vercel-forwarded-for')?.trim() ||
    req.headers.get('x-real-ip')?.trim() ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  return ip
}

export interface RateLimitResult {
  ok: boolean
  retryAfterSec: number
}

export function rateLimit(key: string, max: number, windowMs: number): RateLimitResult {
  const now = Date.now()
  let b = buckets.get(key)
  if (!b || now >= b.resetAt) b = { count: 0, resetAt: now + windowMs }
  b.count++
  buckets.set(key, b)
  if (buckets.size > 20000) {
    // Drop the oldest entry to bound memory.
    const first = buckets.keys().next().value
    if (first) buckets.delete(first)
  }
  if (b.count > max) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) }
  }
  return { ok: true, retryAfterSec: 0 }
}
