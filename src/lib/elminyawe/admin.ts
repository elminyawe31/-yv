import crypto from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { clientKey, rateLimit } from './rate-limit'

/* ============================================================
 *  ELMINYAWE hidden admin area.
 *
 *  Entry point: clicking the ELMINYAWE MEDIA STUDIO mark in the
 *  footer opens the admin dialog (login first).
 *
 *  Auth model (dual-channel):
 *    - Password from ADMIN_PASSWORD env (owner default baked in).
 *    - Login is IP rate-limited and compared in constant time.
 *    - A stateless HMAC-signed token (12h) authorizes admin APIs.
 *    - The token travels BOTH via an httpOnly cookie AND via the
 *      `x-elminyawe-admin` request header (stored in sessionStorage).
 *      Why both: preview panels / embedded contexts block
 *      SameSite=Lax cookies (login succeeded but every follow-up
 *      request returned 401 and the panel kicked the owner out).
 *      The header path works in ANY context — iframes, proxies,
 *      Vercel, localhost — while the cookie still covers classic
 *      same-origin sessions.
 * ============================================================ */

/** Owner-chosen default — override via ADMIN_PASSWORD for production. */
const DEFAULT_ADMIN_PASSWORD = 'Yao12-#'

export const ADMIN_COOKIE = 'elminyawe_admin'
export const ADMIN_HEADER = 'x-elminyawe-admin'
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000

function adminPassword(): string {
  return process.env.ADMIN_PASSWORD || DEFAULT_ADMIN_PASSWORD
}

/** Constant-time string comparison (length leak is acceptable here). */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) {
    crypto.timingSafeEqual(ba, ba) // keep the timing profile flat
    return false
  }
  return crypto.timingSafeEqual(ba, bb)
}

function hmac(payload: string): string {
  return crypto
    .createHmac('sha256', `elminyawe::admin::${adminPassword()}`)
    .update(payload)
    .digest('hex')
}

/** Issue a stateless session token: "<expiry-ms>.<hmac(expiry-ms)>". */
export function issueAdminToken(): string {
  const exp = String(Date.now() + SESSION_TTL_MS)
  return `${exp}.${hmac(exp)}`
}

export function verifyAdminToken(token: string | undefined | null): boolean {
  if (!token) return false
  const dot = token.indexOf('.')
  if (dot < 1) return false
  const exp = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  if (!/^\d{1,16}$/.test(exp) || !/^[0-9a-f]{64}$/.test(sig)) return false
  if (!safeEqual(sig, hmac(exp))) return false
  return Number(exp) > Date.now()
}

export function isAdminRequest(req: NextRequest): boolean {
  return verifyAdminToken(adminTokenFromRequest(req))
}

/**
 * Read the admin session token from whichever channel carries it:
 * the httpOnly cookie (classic same-origin) or the
 * `x-elminyawe-admin` header (iframe / embedded preview friendly).
 */
export function adminTokenFromRequest(req: NextRequest): string | undefined {
  const cookieToken = req.cookies.get(ADMIN_COOKIE)?.value
  if (cookieToken && cookieToken.length > 2) return cookieToken
  const headerToken = req.headers.get(ADMIN_HEADER)?.trim()
  if (headerToken) return headerToken
  return undefined
}

/** Standard 401 for admin-gated endpoints. */
export function adminOnlyResponse(): NextResponse {
  return NextResponse.json(
    { ok: false, admin: true, error: 'هذا الإجراء متاح لمشرف الموقع فقط.' },
    { status: 401 }
  )
}

export function adminCookieOptions(req?: NextRequest) {
  // Behind an HTTPS edge (Vercel / gateway): SameSite=None + Secure
  // so the session cookie also survives embedded iframe previews.
  // Plain HTTP dev: Lax without Secure (None requires Secure).
  const proto = (req?.headers.get('x-forwarded-proto') || '').split(',')[0]?.trim()
  const isHttps = proto === 'https'
  return {
    httpOnly: true,
    sameSite: (isHttps ? 'none' : 'lax') as 'none' | 'lax',
    secure: isHttps || process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  }
}

/** Guard the login endpoint against brute force: 8 tries / 10 minutes / IP. */
export function loginRateLimit(req: NextRequest): { ok: boolean; retryAfterSec: number } {
  return rateLimit(`admin-login:${clientKey(req)}`, 8, 10 * 60_000)
}

export function verifyAdminPassword(candidate: unknown): boolean {
  return typeof candidate === 'string' && safeEqual(candidate, adminPassword())
}
