import { NextResponse, type NextRequest } from 'next/server'
import QRCode from 'qrcode'
import { clientKey, rateLimit } from '@/lib/elminyawe/rate-limit'
import { BRAND } from '@/lib/elminyawe/brand'

export const dynamic = 'force-dynamic'

/**
 * QR code renderer for download links — styled to the ELMINYAWE palette
 * (charcoal-gold modules on warm ivory for reliable scanning).
 * GET /api/qr?d=<absolute /e/ URL>&format=svg|png
 */
export async function GET(req: NextRequest) {
  const limit = rateLimit(clientKey(req), 60, 5 * 60_000)
  if (!limit.ok) {
    return NextResponse.json({ ok: false, error: 'طلبات كثيرة؛ حاول لاحقًا.' }, { status: 429 })
  }

  const data = req.nextUrl.searchParams.get('d') || ''
  const format = req.nextUrl.searchParams.get('format') === 'png' ? 'png' : 'svg'

  // Only encode absolute URLs pointing at this origin's /e/ download paths.
  let parsed: URL
  try {
    parsed = new URL(data)
  } catch {
    return NextResponse.json({ ok: false, error: 'رابط غير صالح.' }, { status: 400 })
  }
  const origin = req.nextUrl.origin
  if (parsed.origin !== origin || !parsed.pathname.startsWith(`/e/${BRAND}-`)) {
    return NextResponse.json({ ok: false, error: 'مسموح فقط بروابط التحميل الخاصة بالموقع.' }, { status: 403 })
  }
  if (data.length > 512) {
    return NextResponse.json({ ok: false, error: 'الرابط طويل جدًا.' }, { status: 400 })
  }

  const opts: QRCode.QRCodeToStringOptions | QRCode.QRCodeToDataURLOptions = {
    errorCorrectionLevel: 'M',
    margin: 2,
    color: { dark: '#221a0cff', light: '#fff8eaff' },
  }

  try {
    if (format === 'png') {
      const dataUrl = await QRCode.toDataURL(data, opts as QRCode.QRCodeToDataURLOptions)
      const base64 = dataUrl.split(',')[1]
      const buf = Buffer.from(base64, 'base64')
      return new NextResponse(new Uint8Array(buf), {
        status: 200,
        headers: {
          'Content-Type': 'image/png',
          'Content-Length': String(buf.length),
          'Cache-Control': 'public, max-age=86400, immutable',
          'Content-Disposition': `inline; filename="${BRAND}-qr.png"`,
        },
      })
    }
    const svg = await QRCode.toString(data, {
      ...(opts as QRCode.QRCodeToStringOptions),
      type: 'svg',
    })
    return new NextResponse(svg, {
      status: 200,
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'public, max-age=86400, immutable',
      },
    })
  } catch (err) {
    console.warn('[qr]', String((err as Error).message).slice(0, 160))
    return NextResponse.json({ ok: false, error: 'تعذّر توليد رمز الاستجابة.' }, { status: 500 })
  }
}
