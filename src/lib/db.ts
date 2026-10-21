import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'

/* ============================================================
 *  Prisma / SQLite client — deployment-portable.
 *
 *  DATABASE_URL resolution (first match wins):
 *    1. Explicit DATABASE_URL env var (local .env / Vercel dashboard)
 *    2. Vercel serverless → file:/tmp/elminyawe.db (writable sandbox)
 *    3. Local dev → <project>/db/custom.db
 *
 *  ensureSchema() idempotently creates the tables so a fresh
 *  clone (or a cold Vercel instance with an empty /tmp) never
 *  crashes on a missing table.
 * ============================================================ */

function resolveDatabaseUrl(): string {
  const explicit = process.env.DATABASE_URL?.trim()
  if (explicit) {
    if (process.env.VERCEL && /^file:/i.test(explicit) && !/^file:\/{1,3}tmp\//i.test(explicit)) {
      /* Only /tmp is writable on Vercel. A relative/bundled SQLite path
       * (e.g. "file:./db/custom.db" pasted into the dashboard) makes EVERY
       * write fail silently — no history, no admin settings, nothing saved.
       * Force the writable sandbox instead of dooming the deployment. */
      console.warn('[db] DATABASE_URL not writable on Vercel — falling back to file:/tmp/elminyawe.db')
      return 'file:/tmp/elminyawe.db'
    }
    return explicit
  }
  if (process.env.VERCEL) return 'file:/tmp/elminyawe.db'
  return `file:${path.join(process.cwd(), 'db', 'custom.db')}`
}

process.env.DATABASE_URL = resolveDatabaseUrl()

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  schemaReady: Promise<void> | undefined
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    /* Query logging is dev-only noise — keep production stdout clean. */
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['query', 'error'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

/** Make sure the SQLite file's parent directory exists (Vercel /tmp etc.). */
function ensureDbDir(): void {
  try {
    const url = process.env.DATABASE_URL || ''
    const m = url.match(/^file:(?!.*\/\/)(.+)$/)
    if (m) {
      const file = m[1]!
      fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true })
    }
  } catch {
    /* best effort */
  }
}

/**
 * Idempotent DDL that mirrors prisma/schema.prisma.
 * Runs at most once per process; failures are swallowed so the
 * app degrades to env-var defaults instead of crashing.
 */
export function ensureSchema(): Promise<void> {
  if (!globalForPrisma.schemaReady) {
    globalForPrisma.schemaReady = (async () => {
      ensureDbDir()
      await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Conversion" (
        "id" TEXT NOT NULL PRIMARY KEY,
        "fileKey" TEXT NOT NULL,
        "ext" TEXT NOT NULL,
        "storage" TEXT NOT NULL DEFAULT 'local',
        "title" TEXT NOT NULL,
        "channel" TEXT,
        "videoId" TEXT,
        "thumbnail" TEXT,
        "quality" TEXT NOT NULL,
        "engine" TEXT NOT NULL DEFAULT 'ytdlp',
        "sizeBytes" INTEGER NOT NULL DEFAULT 0,
        "duration" INTEGER,
        "trimStart" INTEGER,
        "trimEnd" INTEGER,
        "tagged" BOOLEAN NOT NULL DEFAULT false,
        "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`)
      await db.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "Conversion_fileKey_key" ON "Conversion"("fileKey")`)
      await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Conversion_createdAt_idx" ON "Conversion"("createdAt")`)
      await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "AdminSetting" (
        "key" TEXT NOT NULL PRIMARY KEY,
        "value" TEXT NOT NULL,
        "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`)
      /* Migration-safe column adds for databases created before the
       * per-user files system (owner-scoped files section).
       * Check PRAGMA first so warm restarts don't log noisy duplicate errors. */
      try {
        const cols = (await db.$queryRawUnsafe(`PRAGMA table_info("Conversion")`)) as Array<{ name?: string }>
        if (!cols.some((c) => c.name === 'ownerKey')) {
          await db.$executeRawUnsafe(`ALTER TABLE "Conversion" ADD COLUMN "ownerKey" TEXT`)
        }
      } catch {
        /* column already exists or table not created yet */
      }
      try {
        await db.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "Conversion_ownerKey_idx" ON "Conversion"("ownerKey")`)
      } catch {
        /* index already exists */
      }
    })().catch((err) => {
      console.warn('[db:ensureSchema]', String((err as Error).message).slice(0, 160))
    }) as Promise<void>
  }
  return globalForPrisma.schemaReady
}
