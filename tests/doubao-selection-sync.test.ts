import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DoubaoHostAdapter } from '../src/doubao-host-adapter.ts'
import { createDoubaoLlm } from '../src/doubao-llm.ts'

/**
 * The card's Doubao model switches have to reach the HOST's model picker.
 *
 * THE DEFECT: the card kept its selection in the browser's `localStorage`. The picker is
 * rendered from the adapter registry inside the host process, which cannot see a browser
 * store — so switching a model off changed the card and left the picker listing every
 * entry. The two faces of one lane disagreed.
 *
 * These tests pin the seam that closes it: `listModels` filters against the set the card
 * published, and the "never configured" state stays distinguishable from "all switched
 * off" — collapsing the two would either blank a fresh install or re-enable a model the
 * user deliberately turned off.
 */

/** A session that satisfies `sessionUsable` without a live sign-in. */
const SESSION = {
  cookies: { sessionid: 'test-session-id' },
  userAgent: 'test-agent',
  savedAt: new Date(0).toISOString(),
}

/** An adapter whose roster is fixed, so only the FILTER is under test. */
function adapterWith(skipped: ReadonlySet<string> | undefined): DoubaoHostAdapter {
  return new DoubaoHostAdapter({
    session: () => SESSION,
    skipped: async () => skipped,
  })
}

/** The ids `listModels` returns, as a sorted array so order cannot mask a bug. */
async function listedIds(adapter: DoubaoHostAdapter): Promise<string[]> {
  const rows = await adapter.listModels('doubao')
  return rows.map(row => row.id).sort()
}

describe("Doubao's model switches reach the host picker", () => {
  it('serves everything when the user has never configured a selection', async () => {
    // `undefined` is "never touched". A fresh account must not look half-configured, which
    // is why this cannot be treated as an empty allow-list.
    const ids = await listedIds(adapterWith(undefined))
    expect(ids.length).toBeGreaterThan(0)
    expect(ids).toContain('0')
  })

  it('drops a model the card switched off', async () => {
    const all = await listedIds(adapterWith(undefined))
    const target = all.find(id => id === 'image-gen') ?? all[all.length - 1]!
    const ids = await listedIds(adapterWith(new Set([target])))
    expect(ids).not.toContain(target)
    // Everything else survives: the filter removes, it does not narrow to a remnant.
    expect(ids.length).toBe(all.length - 1)
  })

  it('serves nothing when every model is switched off', async () => {
    // A real state, and the one that distinguishes an empty Set from `undefined`.
    const all = await listedIds(adapterWith(undefined))
    const ids = await listedIds(adapterWith(new Set(all)))
    expect(ids).toEqual([])
  })

  it('ignores an id that is not in the roster', async () => {
    // A selection can outlive a model: Doubao retires slugs. A stale id must not throw and
    // must not remove a different model.
    const all = await listedIds(adapterWith(undefined))
    const ids = await listedIds(adapterWith(new Set(['no-such-model-anywhere'])))
    expect(ids).toEqual(all)
  })

  it('still resolves a model the picker is no longer shown', async () => {
    // Hiding a model from the picker is not the same as making it unresolvable: a saved
    // conversation that names it must keep working.
    const adapter = adapterWith(new Set(['image-gen']))
    await adapter.listModels('doubao')
    const resolved = await adapter.resolveModel('doubao', 'image-gen')
    expect(resolved.id).toBe('image-gen')
  })
})

/**
 * The SECOND host path: the lane that feeds the OpenAI gateway's `/v1/models`.
 *
 * Doubao's roster is published twice — once by `DoubaoHostAdapter` for the local picker,
 * once by `createDoubaoLlm` for the gateway. The first patch filtered only the adapter,
 * which left the gateway still advertising every model; both read the same selection now,
 * and these tests pin the second one so the two cannot drift apart again.
 */
describe("Doubao's gateway roster honours the same switches", () => {
  function laneWith(skipped: ReadonlySet<string> | undefined) {
    return createDoubaoLlm({
      session: () => SESSION,
      skipped: async () => skipped,
    })
  }

  async function laneIds(skipped: ReadonlySet<string> | undefined): Promise<string[]> {
    const rows = await laneWith(skipped).listModels('doubao')
    return rows.map(row => row.id).sort()
  }

  it('serves everything when nothing has been configured', async () => {
    const ids = await laneIds(undefined)
    expect(ids.length).toBeGreaterThan(0)
    expect(ids).toContain('0')
  })

  it('drops a switched-off model from the advertised roster', async () => {
    const all = await laneIds(undefined)
    const target = all[all.length - 1]!
    const ids = await laneIds(new Set([target]))
    expect(ids).not.toContain(target)
    expect(ids.length).toBe(all.length - 1)
  })

  it('advertises nothing when every model is off', async () => {
    const all = await laneIds(undefined)
    expect(await laneIds(new Set(all))).toEqual([])
  })

  it('answers an empty list for a provider it does not own', async () => {
    // The lane is asked for every channel id by the gateway roster; only `doubao` is its own.
    const rows = await laneWith(undefined).listModels('trae')
    expect(rows).toEqual([])
  })

  it('treats a throwing selection reader as "not configured"', async () => {
    // An unreadable preference must widen the roster, never blank it.
    const lane = createDoubaoLlm({
      session: () => SESSION,
      skipped: async () => { throw new Error('disk gone') },
    })
    const rows = await lane.listModels('doubao')
    expect(rows.length).toBeGreaterThan(0)
  })
})

/**
 * The store the host half reads.
 *
 * Exercised against a real temporary directory rather than a mock, because the bug class
 * here is a file that is written in one shape and read in another.
 */
describe('the stored Doubao selection', () => {
  let home = ''

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'xdpool-doubao-sel-'))
    process.env['DSH_HOME'] = home
  })

  afterEach(() => {
    delete process.env['DSH_HOME']
    rmSync(home, { recursive: true, force: true })
  })

  it('reports an absent file as never-configured', async () => {
    const { readStoredSkipped } = await import('../src/doubao-store.ts')
    expect(await readStoredSkipped()).toBeUndefined()
  })

  it('round-trips a selection', async () => {
    const { readStoredSkipped, writeStoredSkipped } = await import('../src/doubao-store.ts')
    await writeStoredSkipped(['image-gen', 'person-glm-5-3-261111'])
    const back = await readStoredSkipped()
    expect([...(back ?? [])].sort()).toEqual(['image-gen', 'person-glm-5-3-261111'])
  })

  it('keeps an explicitly empty selection distinct from never-configured', async () => {
    const { readStoredSkipped, writeStoredSkipped } = await import('../src/doubao-store.ts')
    await writeStoredSkipped([])
    const back = await readStoredSkipped()
    expect(back).toBeDefined()
    expect(back?.size).toBe(0)
  })

  it('reads the bare array shape the card used to write', async () => {
    // The card wrote `["id"]` before this route existed. A user upgrading must not lose
    // their selection because the envelope changed.
    const { readStoredSkipped, doubaoSkippedPath } = await import('../src/doubao-store.ts')
    const path = doubaoSkippedPath()
    const { mkdirSync } = await import('node:fs')
    mkdirSync(join(home, '.xdpool'), { recursive: true })
    writeFileSync(path, JSON.stringify(['seed-lite-7b']), 'utf8')
    const back = await readStoredSkipped()
    expect([...(back ?? [])]).toEqual(['seed-lite-7b'])
  })

  it('treats a corrupt file as unconfigured rather than as "all off"', async () => {
    const { readStoredSkipped, doubaoSkippedPath } = await import('../src/doubao-store.ts')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(join(home, '.xdpool'), { recursive: true })
    writeFileSync(doubaoSkippedPath(), 'not json', 'utf8')
    // Blanking the picker would read as a broken channel; serving everything does not.
    expect(await readStoredSkipped()).toBeUndefined()
  })
})
