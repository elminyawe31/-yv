import { NextResponse, type NextRequest } from 'next/server'
import {
  ownerKeyFromRequest,
  getUsage,
  listRecords,
  deleteRecord,
  deleteAllRecords,
  storeModeInfo,
} from '@/lib/elminyawe/records'
import { clientKey, rateLimit } from '@/lib/elminyawe/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * GET /api/storage — the "My files & storage" dashboard payload.
 *
 * Returns the owner's OWN files plus plain usage numbers computed from the
 * very same rows. No quota — storage is unlimited by design; the only cap
 * (80MB per file) is enforced at conversion time.
 */
export async function GET(req: NextRequest) {
  const owner = ownerKeyFromRequest(req)
  try {
    const [usage, files] = await Promise.all([
      getUsage(owner),
      listRecords({ ownerKey: owner, limit: 50 }),
    ])
    const info = storeModeInfo()
    return NextResponse.json({
      ok: true,
      owner,
      mode: info.mode,
      modeLabel: info.label,
      persistent: info.persistent,
      usage: {
        count: usage.count,
        bytes: usage.bytes,
        mb: +(usage.bytes / 1048576).toFixed(2),
      },
      files: files.map((f) => ({
        id: f.id,
        title: f.title,
        ext: f.ext,
        storage: f.storage,
        quality: f.quality,
        engine: f.engine,
        sizeBytes: f.sizeBytes,
        sizeMB: +(f.sizeBytes / 1048576).toFixed(2),
        videoId: f.videoId,
        thumbnail: f.thumbnail,
        path: `/e/ELMINYAWE-${f.fileKey}.${f.ext}`,
        createdAt: f.createdAt,
      })),
    })
  } catch (err) {
    console.warn('[storage]', String((err as Error).message).slice(0, 160))
    return NextResponse.json({ ok: false, error: 'تعذّر قراءة بيانات التخزين.' }, { status: 500 })
  }
}

/**
 * DELETE /api/storage?id=<uuid>  — remove ONE of the owner's own files
 * DELETE /api/storage?all=1      — clear ALL of the owner's own files
 *
 * Owner-scoped: visitors manage their own files without admin rights.
 */
export async function DELETE(req: NextRequest) {
  const limit = rateLimit(clientKey(req), 30, 5 * 60_000)
  if (!limit.ok) {
    return NextResponse.json({ ok: false, error: 'طلبات كثيرة؛ حاول لاحقًا.' }, { status: 429 })
  }

  const owner = ownerKeyFromRequest(req)
  const all = req.nextUrl.searchParams.get('all') === '1'
  const id = req.nextUrl.searchParams.get('id')

  if (!all && !id) {
    return NextResponse.json({ ok: false, error: 'حدّد ملفًا أو اطلب مسح الكل.' }, { status: 400 })
  }

  try {
    if (all) {
      const deleted = await deleteAllRecords(owner)
      const usage = await getUsage(owner)
      return NextResponse.json({ ok: true, deleted, usage: { count: usage.count, bytes: usage.bytes } })
    }
    const deleted = await deleteRecord(id!, owner)
    if (!deleted) {
      return NextResponse.json({ ok: false, error: 'الملف غير موجود ضمن ملفاتك.' }, { status: 404 })
    }
    const usage = await getUsage(owner)
    return NextResponse.json({ ok: true, deleted, usage: { count: usage.count, bytes: usage.bytes } })
  } catch (err) {
    console.warn('[storage:delete]', String((err as Error).message).slice(0, 160))
    return NextResponse.json({ ok: false, error: 'تعذّر حذف الملف.' }, { status: 500 })
  }
}
