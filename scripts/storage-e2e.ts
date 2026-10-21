/**
 * E2E storage pipeline test — exercises the REAL production functions:
 *   saveMedia → createRecord → GET /api/storage → /e stream → DELETE → usage re-computed
 * plus the NO-QUOTA guarantee: oversized stored records never block conversions.
 *
 * Run: bun run scripts/storage-e2e.ts   (from project root)
 */
import fs from 'node:fs'

const BASE = 'http://localhost:3000'
const OWNER = 'E2ETEST1'
const cookie = `el_owner=${OWNER}`
const ok = (cond: boolean, label: string) => {
  console.log(`${cond ? '✅' : '❌'} ${label}`)
  if (!cond) process.exitCode = 1
}

async function main() {
  const { saveMedia } = await import('../src/lib/elminyawe/storage')
  const { createRecord, deleteAllRecords, getUsage } = await import('../src/lib/elminyawe/records')

  /* Clean any leftovers from a previous run */
  await deleteAllRecords(OWNER)
  const before = await getUsage(OWNER)
  ok(before.count === 0, `clean start (0 files, 0 bytes) — got ${before.count}`)

  /* 1) Save a real media file through the production saveMedia() */
  const stored = await saveMedia('/tmp/e2e-tone.mp3', 'mp3', {
    deadlineAt: Date.now() + 60_000,
  })
  ok(stored.sizeBytes === 481152, `saveMedia stored real file (${stored.sizeBytes} bytes)`)
  ok(stored.storage === 'local' && stored.fileKey.startsWith('L'), `local storage key ${stored.fileKey}`)
  ok(fs.existsSync(`/home/z/my-project/db/media/${stored.fileKey}.mp3`), 'file exists on disk in db/media')

  /* 2) Persist the record exactly like /api/convert does */
  const record = await createRecord({
    fileKey: stored.fileKey,
    ext: 'mp3',
    storage: stored.storage,
    title: 'ELMINYAWE Storage E2E Test',
    videoId: 'jNQXAC9IVRw',
    thumbnail: 'https://i.ytimg.com/vi/jNQXAC9IVRw/hqdefault.jpg',
    quality: '128K',
    engine: 'marisa',
    sizeBytes: stored.sizeBytes,
    ownerKey: OWNER,
  })
  ok(Boolean(record.id), `record created with id ${record.id}`)

  /* 3) GET /api/storage — the file must appear, usage must reflect it (no quota fields) */
  const storeRes = await fetch(`${BASE}/api/storage`, { headers: { cookie } })
  const store = await storeRes.json()
  ok(storeRes.status === 200 && store.ok, `GET /api/storage 200 (mode=${store.mode}, persistent=${store.persistent})`)
  ok(store.files.length === 1, `dashboard lists exactly 1 file (got ${store.files.length})`)
  ok(store.files[0]?.title === 'ELMINYAWE Storage E2E Test', `file title correct: ${store.files[0]?.title}`)
  ok(Math.abs(store.usage.mb - 0.46) < 0.05, `usage reflects file size (${store.usage.mb} MB)`)
  ok(store.usage.percent === undefined && store.quotaMB === undefined, 'no quota fields in the payload (unlimited storage)')
  ok(store.owner === OWNER, `owner scoped (${store.owner})`)

  /* 4) Stream the file through /e — full + Range */
  const path = store.files[0].path
  const full = await fetch(`${BASE}${path}`, { headers: { cookie } })
  ok(full.status === 200 && (full.headers.get('content-type') || '').includes('audio/mpeg'), `/e full stream 200 audio/mpeg`)
  const fullLen = Number(full.headers.get('content-length'))
  ok(fullLen === stored.sizeBytes, `content-length matches (${fullLen})`)
  await full.body?.cancel()

  const ranged = await fetch(`${BASE}${path}`, { headers: { cookie, range: 'bytes=0-1023' } })
  ok(ranged.status === 206 && ranged.headers.get('content-range') === `bytes 0-1023/${stored.sizeBytes}`, `/e Range request → 206 + content-range`)

  const head = await fetch(`${BASE}${path}`, { method: 'HEAD', headers: { cookie } })
  ok(head.status === 200 && Number(head.headers.get('content-length')) === stored.sizeBytes, `/e HEAD 200 with length`)

  /* 5) Global history lists it too */
  const hist = await (await fetch(`${BASE}/api/history?limit=24`)).json()
  ok(hist.items.some((i: { fileKey: string }) => i.fileKey === stored.fileKey), 'global history lists the record')

  /* 6) NO-QUOTA guarantee — with an oversized stored record present, POST /api/convert
   *    must start streaming (200 NDJSON), never 403 code:'quota'. */
  await createRecord({
    fileKey: `LE2EBIG${Date.now()}`,
    ext: 'mp3',
    storage: 'local',
    title: 'Unlimited storage test',
    quality: '128K',
    engine: 'ytmp3gl',
    sizeBytes: 85_000_000,
    ownerKey: OWNER,
  })
  const cv = await fetch(`${BASE}/api/convert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', type: 'mp3', quality: '128K' }),
  })
  const cvType = cv.headers.get('content-type') || ''
  ok(cv.status === 200 && cvType.includes('ndjson'), `no quota gate → conversion starts (HTTP ${cv.status}, ${cvType.split(';')[0]})`)
  await cv.body?.cancel() /* abort the real conversion — the check is headers-only */

  /* 7) Delete own file via /api/storage — usage re-computed from remaining rows */
  const del = await fetch(`${BASE}/api/storage?id=${record.id}`, { method: 'DELETE', headers: { cookie } })
  const delData = await del.json()
  ok(del.status === 200 && delData.ok && delData.deleted === 1, `DELETE own file 200 (deleted=${delData.deleted})`)
  const afterDel = await getUsage(OWNER)
  ok(afterDel.count === 1 && afterDel.bytes === 85_000_000, `usage re-computed from remaining rows only (${afterDel.count} file)`)

  /* 8) Someone else cannot delete my file */
  const stranger = await fetch(`${BASE}/api/storage?id=${record.id}`, { method: 'DELETE', headers: { cookie: 'el_owner=E2ETEST9' } })
  ok(stranger.status === 404, `stranger delete → 404 (owner-scoped)`)

  /* 9) Clean up */
  await deleteAllRecords(OWNER)
  const finalUsage = await getUsage(OWNER)
  ok(finalUsage.count === 0 && finalUsage.bytes === 0, `delete-all clears everything (${finalUsage.count} files, ${finalUsage.bytes} bytes)`)

  console.log(`\n${process.exitCode ? '💥 E2E FAILED' : '🎉 E2E STORAGE PIPELINE PASSED'} — unlimited storage, 80MB/file cap only`)
}

main().catch((err) => {
  console.error('💥 E2E crashed:', err)
  process.exit(1)
})
