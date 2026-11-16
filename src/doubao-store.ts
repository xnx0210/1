/**
 * Where the Doubao session lives between runs.
 *
 * WHY A FILE OF ITS OWN
 *
 * Every other channel's credential is owned by the pack, which writes it wherever the host's
 * credential store keeps things. Doubao's session is this plugin's whole lane — one cookie
 * jar, no refresh token, no key — so it belongs beside the plugin's other state and not in a
 * store that would try to interpret it.
 *
 * The file is written atomically and is readable only by the user: it holds a live session,
 * and a half-written jar would present as "signed in" while every request failed.
 *
 * @module dsh-xdpool/doubao-store
 */
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { DoubaoSession } from './doubao-auth.ts'
import { pluginDataDir } from './ignored.ts'

/** The file the session is kept in. */
export const DOUBAO_SESSION_FILE = 'doubao-session.json'

/** The absolute path of the session file. */
export function doubaoSessionPath(): string {
  return join(pluginDataDir(), DOUBAO_SESSION_FILE)
}

/** Read the stored session, or undefined when there is none or it is unreadable. */
export async function readStoredSession(): Promise<DoubaoSession | undefined> {
  let text: string
  try {
    text = await readFile(doubaoSessionPath(), 'utf8')
  } catch {
    return undefined
  }
  try {
    const parsed = JSON.parse(text) as Partial<DoubaoSession>
    if (typeof parsed.cookies !== 'object' || parsed.cookies === null) return undefined
    const cookies: Record<string, string> = {}
    for (const [name, value] of Object.entries(parsed.cookies)) {
      if (typeof value === 'string') cookies[name] = value
    }
    if (typeof cookies['sessionid'] !== 'string' || cookies['sessionid'] === '') return undefined
    return {
      cookies,
      userAgent: typeof parsed.userAgent === 'string' && parsed.userAgent !== ''
        ? parsed.userAgent
        : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 SamanthaDoubao/2.31.4',
      savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : new Date(0).toISOString(),
    }
  } catch {
    // A malformed file is not a session; the user signs in again rather than the lane
    // pretending to work.
    return undefined
  }
}

/** Write the session atomically, readable only by its owner. */
export async function writeStoredSession(session: DoubaoSession): Promise<void> {
  const target = doubaoSessionPath()
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.tmp`
  await writeFile(temporary, JSON.stringify(session, null, 2), { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, target)
}

/** Remove the stored session. */
export async function removeStoredSession(): Promise<void> {
  try {
    await unlink(doubaoSessionPath())
  } catch {
    // Nothing to remove is the state the caller wanted.
  }
}

/**
 * The file the model selection is kept in.
 *
 * SEPARATE FROM THE SESSION ON PURPOSE. The session is a credential and is written with
 * `0o600`; the selection is a preference and has to be readable by the HOST half on every
 * picker read. Sharing one file would either make the preference secret or weaken the
 * credential, and neither trade is needed — they change on completely different events.
 */
export const DOUBAO_SKIPPED_FILE = 'doubao-skipped-models.json'

/** The absolute path of the model-selection file. */
export function doubaoSkippedPath(): string {
  return join(pluginDataDir(), DOUBAO_SKIPPED_FILE)
}

/**
 * The Doubao model ids the user switched off.
 *
 * `undefined` means "never configured", which is NOT the same as "none switched off":
 * the first must show every model (a fresh install), the second must show none (the
 * user really did switch everything off). The card's browser half stores the same
 * distinction, and collapsing the two here would make a first run look half-configured.
 *
 * A file that cannot be read or parsed is reported as `undefined` rather than as an empty
 * set: an unreadable preference is not evidence that every model was disabled, and
 * blanking the picker would read as a broken channel.
 */
export async function readStoredSkipped(): Promise<ReadonlySet<string> | undefined> {
  let text: string
  try {
    text = await readFile(doubaoSkippedPath(), 'utf8')
  } catch {
    return undefined
  }
  try {
    const parsed = JSON.parse(text) as unknown
    // Accept both shapes: the bare array the card writes, and the versioned envelope.
    const ids = Array.isArray(parsed)
      ? parsed
      : (parsed as { ids?: unknown } | null)?.ids
    if (!Array.isArray(ids)) return undefined
    return new Set(ids.filter((id): id is string => typeof id === 'string'))
  } catch {
    return undefined
  }
}

/**
 * Record the Doubao model ids the user switched off.
 *
 * Written atomically for the same reason the session is: a half-written preference would
 * present as a truncated selection, and the picker would silently re-enable models the
 * user had turned off.
 */
export async function writeStoredSkipped(ids: readonly string[]): Promise<void> {
  const target = doubaoSkippedPath()
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.tmp`
  await writeFile(temporary, JSON.stringify({ version: 1, ids: [...ids] }, null, 2), { encoding: 'utf8' })
  await rename(temporary, target)
}
