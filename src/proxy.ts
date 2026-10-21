import { NextResponse, type NextRequest } from 'next/server'

/* ============================================================================
 *  ELMINYAWE owner identity proxy (Next.js 16 "proxy" convention —
 *  the successor of middleware.ts).
 *
 *  Every visitor gets a short, friendly "file number" (e.g. 7F3A21BC) in a
 *  cookie. This is the key that scopes their personal "My files" dashboard
 *  (storage is unlimited by design — the number is only an identity for
 *  listing/deleting one's own files, never a quota).
 *
 *  Runs on every non-static path; all it does is set the cookie when missing.
 * ============================================================================
 */

const OWNER_COOKIE = 'el_owner'

export default function proxy(req: NextRequest) {
  const res = NextResponse.next()

  const existing = req.cookies.get(OWNER_COOKIE)?.value
  const valid = existing && /^[A-Za-z0-9]{6,12}$/.test(existing)
  if (!valid) {
    /* 8 hex chars — readable, non-sequential, no personal data. */
    const owner = Array.from({ length: 8 }, () =>
      '0123456789ABCDEF'[Math.floor(Math.random() * 16)]
    ).join('')
    res.cookies.set(OWNER_COOKIE, owner, {
      httpOnly: false, /* the dashboard shows "your number" client-side */
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 365, /* 1 year */
    })
  }
  return res
}

export const config = {
  /* Everything except Next's static assets and the media stream route
   * (the /e stream must stay header-light and cache-friendly). */
  matcher: ['/((?!_next/static|_next/image|favicon.ico|e/).*)'],
}
