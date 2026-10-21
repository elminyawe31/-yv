import { getSetting } from '../records'

/* ============================================================
 *  Cloudflare Turnstile solver
 *  Used by engine 1 (cdnframe api — the protection-bypass engine).
 *
 *  Solver URL resolution (first match wins):
 *    1. Runtime override saved from the hidden admin panel
 *       (durable setting "solver_url" — Catbox records on serverless,
 *        SQLite locally — lets the owner swap a dead/expired solver
 *        service instantly, no redeploy, and it SURVIVES restarts)
 *    2. ELMINYAWE_SOLVER_URL env var ("off"/"disabled" disables it)
 *    3. Built-in default owner service
 *              https://turn-production-779f.up.railway.app
 *            (verified live: solved the clickapi.net challenge in ~4s,
 *             ELMINYAWE Solver v3.4.0 — replaces the dead 7f89 instance)
 *
 *  ANY solver that follows the same contract works out of the box:
 *    GET {base}/solve?url=<page>&sitekey=<key> → { result: { token } }
 *  Paste it in ANY shape (bare root, trailing slashes, /solve
 *  already included, a sub-path, or a full URL with its own query)
 *  — solverCandidates() below derives the right endpoint shapes and
 *  solveInternal() probes them and reports which one answered.
 *
 *  Legacy fallbacks (only when 1-3 are all unavailable):
 *    TURNSTILE_TOKEN → manually supplied token (testing only)
 *    CAPSOLVER_API_KEY → capsolver.com (AntiTurnstileTaskProxyLess)
 *    TWO_CAPTCHA_API_KEY / CAPTCHA_2CAPTCHA_API_KEY → 2captcha.com
 * ============================================================ */

export const DEFAULT_SOLVER_URL = 'https://turn-production-779f.up.railway.app'

/** Known challenge parameters for the engine-1 widget (clickapi.net). */
export const TURNSTILE_SITE_KEY = '0x4AAAAAAB7R_--firW0k1YT'
export const TURNSTILE_PAGE_URL = 'https://clickapi.net/'

const DB_OVERRIDE_KEY = 'solver_url'
const CONFIG_CACHE_TTL_MS = 10_000

export type SolverSource = 'override' | 'env' | 'default'

export interface SolverConfig {
  url: string
  source: SolverSource
}

/* ---------------- resolution + short cache ---------------- */

let cfgCache: { cfg: SolverConfig; at: number } | null = null

/** Drop the cached solver config (called after admin changes). */
export function invalidateSolverCache(): void {
  cfgCache = null
}

async function dbOverride(): Promise<string | null> {
  try {
    const value = (await getSetting(DB_OVERRIDE_KEY))?.trim()
    if (value && /^https?:\/\/.+/i.test(value)) return normalizeSolverUrl(value)
    if (value && value.toLowerCase() === 'off') return 'off'
  } catch {
    /* store unavailable → env/default */
  }
  return null
}

/** Resolve the active ELMINYAWE solver URL (cached ~10s). */
export async function getSolverConfig(): Promise<SolverConfig> {
  if (cfgCache && Date.now() - cfgCache.at < CONFIG_CACHE_TTL_MS) return cfgCache.cfg

  let cfg: SolverConfig
  const override = await dbOverride()
  if (override === 'off') {
    cfg = { url: '', source: 'override' }
  } else if (override) {
    cfg = { url: override, source: 'override' }
  } else {
    const env = (process.env.ELMINYAWE_SOLVER_URL || '').trim()
    if (env && env.toLowerCase() !== 'off' && env.toLowerCase() !== 'disabled') {
      cfg = { url: normalizeSolverUrl(env), source: 'env' }
    } else if (env.toLowerCase() === 'off' || env.toLowerCase() === 'disabled') {
      cfg = { url: '', source: 'env' }
    } else {
      cfg = { url: DEFAULT_SOLVER_URL, source: 'default' }
    }
  }

  cfgCache = { cfg, at: Date.now() }
  return cfg
}

export interface TurnstileSolverInfo {
  service: 'elminyawe' | 'capsolver' | '2captcha' | 'manual' | 'none'
  hasKey: boolean
  url?: string
  source?: SolverSource
}

export async function getSolverInfo(): Promise<TurnstileSolverInfo> {
  const cfg = await getSolverConfig()
  if (cfg.url) return { service: 'elminyawe', hasKey: true, url: cfg.url, source: cfg.source }
  if (process.env.TURNSTILE_TOKEN) return { service: 'manual', hasKey: true }
  if (process.env.CAPSOLVER_API_KEY) return { service: 'capsolver', hasKey: true }
  if (process.env.TWO_CAPTCHA_API_KEY || process.env.CAPTCHA_2CAPTCHA_API_KEY)
    return { service: '2captcha', hasKey: true }
  return { service: 'none', hasKey: false }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Solve a Turnstile challenge and return the `cf-turnstile-response` token. */
export async function solveTurnstile(siteKey: string, pageUrl: string, timeoutMs = 120_000): Promise<string> {
  const cfg = await getSolverConfig()
  if (cfg.url) return solveViaElminyawe(cfg.url, siteKey, pageUrl, timeoutMs)

  const manual = process.env.TURNSTILE_TOKEN
  if (manual) return manual

  const capsolver = process.env.CAPSOLVER_API_KEY
  if (capsolver) return solveViaCapsolver(capsolver, siteKey, pageUrl, timeoutMs)

  const twocaptcha = process.env.TWO_CAPTCHA_API_KEY || process.env.CAPTCHA_2CAPTCHA_API_KEY
  if (twocaptcha) return solveVia2Captcha(twocaptcha, siteKey, pageUrl, timeoutMs)

  throw new Error('NO_SOLVER_KEY')
}

/* ---------------- ELMINYAWE Solver (owner's private service) ---------------- */

/**
 * Normalize an owner-supplied solver URL (any shape):
 * trims whitespace, drops trailing slashes. Accepts bare roots
 * ("https://host"), roots with slashes, full endpoints
 * ("https://host/solve") and even URLs carrying their own query.
 */
export function normalizeSolverUrl(raw: string): string {
  return raw.trim().replace(/\s+/g, '').replace(/\/+$/, '')
}

/** Compact endpoint label for log lines (no protocol noise). */
function shortUrl(u: string): string {
  return u.replace(/^https?:\/\//i, '').slice(0, 60)
}

/**
 * Endpoint candidates for a solver base. The same solver software is
 * deployed at different URL shapes (Railway, deplexo, custom domains…):
 *   https://host                    → /solve first, bare / as fallback
 *   https://host/solve              → as-is first, bare / as fallback
 *   https://host/sub                → /sub/solve first, /sub as fallback
 *   https://host/…?query            → verbatim (owner knows best)
 * Every candidate keeps the identical `/solve?url=<page>&sitekey=<key>`
 * contract, so swapping services never needs code changes.
 */
export function solverCandidates(base: string): string[] {
  const b = normalizeSolverUrl(base)
  if (!/^https?:\/\/[^\s]+$/i.test(b)) return []
  if (b.includes('?')) return [b]
  const solveSuffix = /\/(?:solve|solve\.php|api\/solve)$/i
  const canonical = solveSuffix.test(b) ? b : `${b}/solve`
  const out: string[] = [canonical]
  /* Bare-root fallbacks — some deployments serve the solver directly at the
   * path root (…/api) or even at the host root instead of a /solve route.
   * Each extra candidate costs one cheap 404-probe at most. */
  const subRoot = b.replace(/\/(?:solve|solve\.php)$/i, '')
  let hostRoot = b
  try {
    hostRoot = new URL(b).origin
  } catch {
    /* keep raw */
  }
  for (const c of [subRoot, hostRoot]) {
    if (c && !out.includes(c)) out.push(c)
  }
  return out
}

/** Pull the token out of any known solver response shape. */
function extractToken(data: unknown): unknown {
  const d = data as
    | {
        result?: { token?: unknown }
        solution?: { token?: unknown }
        cf_tokens?: Record<string, unknown>
        data?: { token?: unknown }
        token?: unknown
        value?: unknown
      }
    | null
  if (!d || typeof d !== 'object') return undefined
  return (
    d.result?.token ??
    d.solution?.token ??
    d.cf_tokens?.['cf-turnstile-response'] ??
    d.data?.token ??
    d.token ??
    d.value
  )
}

/**
 * GET {solver-endpoint}?url=<page>&sitekey=<key>
 * → { status:'ok', result:{token}, solution:{token}, cf_tokens:{…} } (+ clones)
 * Tries every endpoint shape. Each shape gets several attempts with
 * ADAPTIVE waits: PaaS-hosted solvers (deplexo free tier etc.) sleep
 * and answer 503/HTML while booting — a longer poke interval gives
 * them time to wake instead of failing after a single try.
 */
async function solveInternal(
  base: string,
  siteKey: string,
  pageUrl: string,
  timeoutMs: number
): Promise<{ token: string; endpoint: string; version?: string }> {
  const candidates = solverCandidates(base)
  if (!candidates.length) throw new Error('رابط خدمة الحل غير صالح')

  const params = new URLSearchParams({ url: pageUrl, sitekey: siteKey })
  const deadline = Date.now() + timeoutMs
  let lastError = ''

  for (const endpoint of candidates) {
    for (let attempt = 0; attempt < 4; attempt++) {
      if (Date.now() >= deadline) break
      const budget = Math.max(12_000, deadline - Date.now())
      try {
        const res = await fetch(`${endpoint}?${params.toString()}`, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(budget),
        })
        if (res.status === 404 || res.status === 405) {
          // Wrong endpoint shape for THIS deployment → try the next candidate.
          lastError = `HTTP ${res.status} · ${shortUrl(endpoint)}`
          break
        }
        const text = (await res.text().catch(() => '')).trim()
        if (res.status === 503 || text.startsWith('<')) {
          /* HTML/503 = the hosting is waking the container up (PaaS sleep).
           * Wait longer and poke again — it usually comes alive. */
          lastError = `الخدمة تستيقظ (HTTP ${res.status}) · ${shortUrl(endpoint)}`
          if (Date.now() < deadline - 9_000) {
            await sleep(8_000)
            continue
          }
          break
        }
        let data: unknown = null
        try {
          data = JSON.parse(text)
        } catch {
          data = null
        }
        const token = extractToken(data)
        if (typeof token === 'string' && token.length > 20) {
          const version = (data as { version?: string } | null)?.version
          return { token, endpoint, ...(version ? { version } : {}) }
        }
        const d = data as { message?: string; error?: { detail?: string } } | null
        lastError = String(d?.error?.detail || d?.message || `HTTP ${res.status}`)
      } catch (err) {
        lastError = String((err as Error).message || err)
      }
      if (Date.now() < deadline - 4_000) await sleep(3_000)
    }
    if (Date.now() >= deadline) break
  }
  throw new Error(`ELMINYAWE Solver: ${lastError.slice(0, 140) || 'انتهت مهلة الحل'}`)
}

async function solveViaElminyawe(
  base: string,
  siteKey: string,
  pageUrl: string,
  timeoutMs: number
): Promise<string> {
  return (await solveInternal(base, siteKey, pageUrl, timeoutMs)).token
}

/** One documented test step — rendered as a badge in the admin panel. */
export interface SolverTestStep {
  name: string
  ok: boolean
  ms: number
  status?: string
  detail?: string
  hint?: { ar: string; en: string }
}

/** Fully documented solver test report (v5.3 — "وثّق الاختبار أكثر"). */
export interface SolverTestReport {
  ok: boolean
  ms: number
  steps: SolverTestStep[]
  /** Solver software version reported by the service (e.g. "3.4.0"). */
  version?: string
  /** Endpoint shape that actually answered. */
  endpoint?: string
  tokenLength?: number
  tokenPreview?: string
  error?: string
}

/**
 * One-shot DOCUMENTED health probe used by the admin panel "test" button.
 * Never throws — returns a step-by-step report instead, so the owner sees
 * exactly WHAT was checked, HOW LONG it took, and WHERE it broke:
 *   1. reach     — is the service alive at all? (instant, ≤9s)
 *   2. endpoint  — does an expected /solve-shaped endpoint exist? (≤6s/each)
 *   3. solve     — fires a REAL Turnstile challenge with the remaining budget.
 *   4. token     — is the returned token well-formed (>20 chars)?
 */
export async function testElminyaweSolver(
  base: string,
  siteKey: string,
  pageUrl: string,
  timeoutMs = 45_000
): Promise<SolverTestReport> {
  const started = Date.now()
  const steps: SolverTestStep[] = []

  /* ---- Step 1: reachability (instant verdict on dead links) ---- */
  let origin = base
  try {
    origin = new URL(base).origin
  } catch {
    /* keep raw */
  }
  let reachOk = false
  let reachStatus = ''
  const t0 = Date.now()
  try {
    const res = await fetch(origin, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(Math.min(9_000, Math.max(4_000, timeoutMs))),
    })
    reachOk = true
    reachStatus = `HTTP ${res.status}`
    const text = (await res.text().catch(() => '')).trim()
    if (text.startsWith('<')) reachStatus += ' · HTML'
    else if (text.length > 0) reachStatus += ' · JSON/text'
  } catch (err) {
    reachStatus = String((err as Error).message || err).slice(0, 100)
  }
  steps.push({
    name: 'reach',
    ok: reachOk,
    ms: Date.now() - t0,
    status: reachStatus,
    ...(reachOk ? {} : { detail: reachStatus }),
    ...(reachOk
      ? {}
      : {
          hint: {
            ar: 'الخدمة لا تستجيب إطلاقًا — الرابط غير صحيح أو الخدمة متوقفة/محذوفة. افتح الرابط في المتصفح للتأكد أولًا.',
            en: 'The service is not responding at all — the URL is wrong or the service is stopped/deleted. Open the URL in a browser to check first.',
          },
        }),
  })
  if (!reachOk) {
    return { ok: false, ms: Date.now() - started, steps, error: 'الخدمة غير قابلة للوصول.' }
  }

  /* ---- Step 2: endpoint shape detection ---- */
  const t1 = Date.now()
  const candidates = solverCandidates(base)
  let foundEndpoint = ''
  const probes: string[] = []
  for (const endpoint of candidates.slice(0, 3)) {
    try {
      const res = await fetch(endpoint, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(6_000),
      })
      probes.push(`${shortUrl(endpoint)} → ${res.status}`)
      await res.body?.cancel().catch(() => {})
      /* 400 = the endpoint exists and demands its ?url=&sitekey= params;
       * 200 with a body = a root that answered directly. Both are live. */
      if (res.status === 400 || res.status === 200) {
        foundEndpoint = endpoint
        break
      }
    } catch (err) {
      probes.push(`${shortUrl(endpoint)} → ${String((err as Error).message || err).slice(0, 40)}`)
    }
  }
  const endpointOk = !!foundEndpoint
  steps.push({
    name: 'endpoint',
    ok: endpointOk,
    ms: Date.now() - t1,
    status: endpointOk ? `@ ${shortUrl(foundEndpoint)}` : probes.join(' · ').slice(0, 120),
    ...(endpointOk
      ? {}
      : {
          hint: {
            ar: 'الخدمة تعمل لكن نقطة الحل المتوقعة (/solve) غير موجودة — تأكد أنها خدمة من نوع ELMINYAWE Solver أو مكافئة.',
            en: 'The service runs but the expected /solve endpoint was not found — make sure it is an ELMINYAWE Solver-compatible service.',
          },
        }),
  })
  if (!endpointOk) {
    return { ok: false, ms: Date.now() - started, steps, error: 'لم يُعثر على نقطة نهاية صالحة للحل.' }
  }

  /* ---- Step 3: REAL challenge solve ---- */
  const t2 = Date.now()
  const solveBudget = Math.max(12_000, Math.min(timeoutMs - (Date.now() - started), 42_000))
  let solved: { token: string; endpoint: string; version?: string } | null = null
  let solveError = ''
  try {
    solved = await solveInternal(base, siteKey, pageUrl, solveBudget)
  } catch (err) {
    solveError = String((err as Error).message || err).slice(0, 200)
  }
  steps.push({
    name: 'solve',
    ok: !!solved,
    ms: Date.now() - t2,
    ...(solved ? { status: solved.version ? `v${solved.version}` : 'solved' } : { detail: solveError }),
    ...(solved
      ? {}
      : {
          hint: {
            ar: 'الخدمة استجابت لكنها لم تحل التحدي — غالبًا الحاوية نائمة وتحتاج دقيقة للاستيقاظ؛ أعد الاختبار بعد قليل.',
            en: 'The service responded but did not solve the challenge — the container is likely asleep and needs a minute; retry shortly.',
          },
        }),
  })
  if (!solved) {
    return { ok: false, ms: Date.now() - started, steps, error: solveError || 'فشل حل التحدي.' }
  }

  /* ---- Step 4: token shape validation ---- */
  const t3 = Date.now()
  const tokenOk = solved.token.length > 20
  steps.push({
    name: 'token',
    ok: tokenOk,
    ms: Date.now() - t3,
    status: tokenOk ? `${solved.token.length} chars` : 'malformed',
    ...(tokenOk
      ? {}
      : {
          hint: {
            ar: 'التوكن المُستلم غير مكتمل — أعد الاختبار.',
            en: 'The received token is malformed — retry the test.',
          },
        }),
  })

  return {
    ok: tokenOk,
    ms: Date.now() - started,
    steps,
    ...(solved.version ? { version: solved.version } : {}),
    endpoint: shortUrl(solved.endpoint),
    tokenLength: solved.token.length,
    tokenPreview: `${solved.token.slice(0, 12)}…${solved.token.slice(-6)}`,
    ...(tokenOk ? {} : { error: 'التوكن غير صالح.' }),
  }
}

/* ---------------- CapSolver ---------------- */

async function solveViaCapsolver(
  clientKey: string,
  siteKey: string,
  pageUrl: string,
  timeoutMs: number
): Promise<string> {
  const create = await postJson('https://api.capsolver.com/createTask', {
    clientKey,
    task: {
      type: 'AntiTurnstileTaskProxyLess',
      websiteURL: pageUrl,
      websiteKey: siteKey,
    },
  })
  const taskId = create?.taskId
  if (!taskId) {
    throw new Error(`CapSolver: ${String(create?.errorDescription ?? 'فشل إنشاء المهمة')}`)
  }

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await sleep(3000)
    const result = await postJson('https://api.capsolver.com/getTaskResult', { clientKey, taskId })
    if (result?.status === 'ready' && result?.solution?.token) return String(result.solution.token)
    if (result?.errorId && result.errorId !== 0) {
      throw new Error(`CapSolver: ${String(result.errorDescription ?? 'خطأ غير معروف')}`)
    }
  }
  throw new Error('CapSolver: انتهت مهلة حل التحدي.')
}

/* ---------------- 2Captcha ---------------- */

async function solveVia2Captcha(
  apiKey: string,
  siteKey: string,
  pageUrl: string,
  timeoutMs: number
): Promise<string> {
  const res = await fetch(
    `https://2captcha.com/in.php?key=${encodeURIComponent(apiKey)}&method=turnstile&sitekey=${encodeURIComponent(
      siteKey
    )}&pageurl=${encodeURIComponent(pageUrl)}&json=1`,
    { signal: AbortSignal.timeout(30_000) }
  )
  const created = (await res.json()) as { status: number; request: string }
  if (created.status !== 1) throw new Error(`2Captcha: ${created.request || 'فشل إنشاء المهمة'}`)

  const taskId = created.request
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await sleep(5000)
    const poll = await fetch(
      `https://2captcha.com/res.php?key=${encodeURIComponent(apiKey)}&action=get&json=1&id=${taskId}`,
      { signal: AbortSignal.timeout(30_000) }
    )
    const data = (await poll.json()) as { status: number; request: string }
    if (data.status === 1) return data.request
    if (data.request !== 'CAPCHA_NOT_READY') throw new Error(`2Captcha: ${data.request}`)
  }
  throw new Error('2Captcha: انتهت مهلة حل التحدي.')
}

/* ---------------- shared ---------------- */

async function postJson(url: string, body: Record<string, unknown>): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45_000),
  })
  return res.json().catch(() => null)
}
