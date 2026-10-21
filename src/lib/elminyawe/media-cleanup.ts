import fs from 'node:fs'
import path from 'node:path'
import { MEDIA_DIR, CATBOX_USERHASH } from './brand'
import { deleteCatboxFiles } from './catbox'

/* ============================================================================
 *  Artefact cleanup for deleted conversion records (v5.4 — Catbox only).
 *  Shared by every record-store mode (sqlite / catbox / memory) so the
 *  deletion semantics are IDENTICAL everywhere:
 *    • storage 'catbox' → DELETE the remote Catbox object (the record's
 *      fileKey IS the catbox id) + drop the local mirror. The dashboard
 *      dialog already promises "سيُحذف من قائمتك ومن التخزين الخارجي
 *      نهائيًا" — since v5.4 that promise is actually kept.
 *    • storage 'local'  → delete db/media/L{key}.{ext}
 *  Records dedupe by fileKey (one record per external file), so removing
 *  a record never orphans another owner's link.
 *  Best-effort: failures never break the record deletion itself.
 * ============================================================================
 */

export function removeMediaFiles(fileKey: string, ext: string, storage: string): void {
  try {
    if (storage === 'local') {
      const p = path.join(MEDIA_DIR, `${fileKey}.${ext}`)
      if (fs.existsSync(p)) fs.rmSync(p, { force: true })
    } else if (storage === 'catbox') {
      // Drop the warm local mirror…
      const mirror = path.join(MEDIA_DIR, `C${fileKey}.${ext}`)
      if (fs.existsSync(mirror)) fs.rmSync(mirror, { force: true })
      /* …and actually delete the remote object from the owner's Catbox
       * account. Fire-and-forget: the record row removal is what the
       * caller waits for; the remote delete runs on its own budget. */
      void (async () => {
        const res = await deleteCatboxFiles([`${fileKey}.${ext}`], { userhash: CATBOX_USERHASH })
        if (!res.ok) {
          console.warn(
            `[media-cleanup] catbox delete failed for ${fileKey}.${ext}:`,
            res.error || `HTTP ${res.status}`
          )
        }
      })()
    }
  } catch {
    /* best effort — the DB row removal is what matters */
  }
}
