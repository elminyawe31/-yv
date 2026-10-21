import { NextResponse, type NextRequest } from 'next/server'
import { isAdminRequest, adminOnlyResponse } from '@/lib/elminyawe/admin'
import { clientKey, rateLimit } from '@/lib/elminyawe/rate-limit'
import { listRecords, deleteRecord, deleteAllRecords } from '@/lib/elminyawe/records'

export const dynamic = 'force-dynamic'

/**
 * GET /api/history — public global conversion log (newest first).
 * Reads through the unified mode-aware record store, so on Vercel the log
 * is served from the durable Catbox records document instead of an
 * ephemeral /tmp SQLite file that dies with every cold start.
 */
export async function GET(req: NextRequest) {
  const limitParam = req.nextUrl.searchParams.get('limit')
  const limit = Math.min(Math.max(Number(limitParam) || 8, 1), 24)
  const items = await listRecords({ limit })
  return NextResponse.json({
    ok: true,
    items: items.map((item) => ({
      ...item,
      path: `/e/ELMINYAWE-${item.fileKey}.${item.ext}`,
      sizeMB: +(item.sizeBytes / 1048576).toFixed(2),
    })),
  })
}

/**
 * DELETE /api/history?id=<uuid>  — remove one entry (admin-only)
 * DELETE /api/history?all=1     — clear the whole log (admin-only)
 *
 * Owner decision: history removal is admin-only. The hidden panel
 * (footer ELMINYAWE mark) is where visitors sign in. Per-user deletion
 * of one's OWN files lives in /api/storage instead.
 */
export async function DELETE(req: NextRequest) {
  if (!isAdminRequest(req)) return adminOnlyResponse()

  const limit = rateLimit(clientKey(req), 30, 10 * 60_000)
  if (!limit.ok) {
    return NextResponse.json({ ok: false, error: 'طلبات كثيرة؛ حاول لاحقًا.' }, { status: 429 })
  }

  const all = req.nextUrl.searchParams.get('all') === '1'
  const id = req.nextUrl.searchParams.get('id')

  if (!all && !id) {
    return NextResponse.json({ ok: false, error: 'حدّد عنصرًا أو اطلب مسح الكل.' }, { status: 400 })
  }

  try {
    if (all) {
      const deleted = await deleteAllRecords(null)
      return NextResponse.json({ ok: true, deleted })
    }

    const deleted = await deleteRecord(id!, null)
    if (!deleted) return NextResponse.json({ ok: false, error: 'العنصر غير موجود.' }, { status: 404 })
    return NextResponse.json({ ok: true, deleted: 1 })
  } catch (err) {
    console.warn('[history:delete]', String((err as Error).message).slice(0, 160))
    return NextResponse.json({ ok: false, error: 'تعذّر الحذف من السجل.' }, { status: 500 })
  }
}
