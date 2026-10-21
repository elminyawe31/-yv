import { NextResponse, type NextRequest } from 'next/server'
import {
  ADMIN_COOKIE,
  adminCookieOptions,
  issueAdminToken,
  isAdminRequest,
  loginRateLimit,
  verifyAdminPassword,
} from '@/lib/elminyawe/admin'

export const dynamic = 'force-dynamic'

/** GET — is the current visitor carrying a valid admin session? (cookie or header) */
export async function GET(req: NextRequest) {
  return NextResponse.json({ ok: true, authed: isAdminRequest(req) })
}

/** POST { password } — hidden-panel login. Rate-limited per IP. */
export async function POST(req: NextRequest) {
  const limit = loginRateLimit(req)
  if (!limit.ok) {
    return NextResponse.json(
      { ok: false, error: `محاولات كثيرة؛ أعد المحاولة بعد ${limit.retryAfterSec} ثانية.` },
      { status: 429 }
    )
  }

  let password: unknown = null
  try {
    const body = (await req.json()) as { password?: unknown }
    password = body?.password
  } catch {
    /* invalid JSON */
  }

  if (!verifyAdminPassword(password)) {
    return NextResponse.json({ ok: false, error: 'كلمة المرور غير صحيحة.' }, { status: 401 })
  }

  // Dual-channel session: set the httpOnly cookie AND return the
  // signed token so embedded/iframe contexts (which block cookies)
  // can keep sending it via the `x-elminyawe-admin` header.
  const token = issueAdminToken()
  const res = NextResponse.json({ ok: true, authed: true, token })
  res.cookies.set(ADMIN_COOKIE, token, adminCookieOptions(req))
  return res
}

/** DELETE — logout. */
export async function DELETE(req: NextRequest) {
  const res = NextResponse.json({ ok: true, authed: false })
  res.cookies.set(ADMIN_COOKIE, '', { ...adminCookieOptions(req), maxAge: 0 })
  return res
}
