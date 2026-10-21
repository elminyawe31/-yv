import { execFile } from 'node:child_process'
import { HOBBY_TIMEOUT_MESSAGE } from './brand'

export interface RunOptions {
  timeout?: number
  dir?: string
  signal?: AbortSignal
  onStdout?: (chunk: string) => void
}

export interface RunResult {
  stdout: string
  stderr: string
}

/**
 * Promisified execFile with hard timeout + abort support.
 * Kills the whole detached process group so ffmpeg children never outlive yt-dlp.
 */
export function run(cmd: string, args: string[], { timeout = 45_000, dir, signal, onStdout }: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('أُلغِيَ التحويل بعد إغلاق الطلب.'))
    const env: NodeJS.ProcessEnv = { ...process.env }
    for (const secret of ['CATBOX_USERHASH', 'ADMIN_TOKEN', 'YT_COOKIES_B64']) delete env[secret]
    if (dir) {
      env.TMPDIR = dir
      env.XDG_CACHE_HOME = dir
    }
    let expired = false
    let stdout = ''
    let stderr = ''

    const child = execFile(
      cmd,
      args,
      { maxBuffer: 4 * 1024 * 1024, env, detached: process.platform !== 'win32' },
      (err, out, errOut) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', terminate)
        if (err) {
          return reject(
            new Error(
              signal?.aborted
                ? 'أُلغِيَ التحويل بعد إغلاق الطلب.'
                : expired
                  ? HOBBY_TIMEOUT_MESSAGE
                  : (stderr || err.message).slice(-1000)
            )
          )
        }
        resolve({ stdout: out, stderr: errOut })
      }
    )

    if (onStdout) {
      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        stdout += chunk
        onStdout(chunk)
      })
    }
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk
    })

    function terminate() {
      if (process.platform !== 'win32' && child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL')
          return
        } catch {
          /* already exited */
        }
      }
      child.kill('SIGKILL')
    }
    const timer = setTimeout(() => {
      expired = true
      terminate()
    }, timeout)
    timer.unref?.()
    signal?.addEventListener('abort', terminate, { once: true })
    if (signal?.aborted) terminate()
  })
}
