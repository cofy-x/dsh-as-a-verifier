import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ScoreCache, scoreCacheDigest, type ScoreCacheKey } from '../src/cache/score-cache.ts'
import { ProgressCache, progressCacheDigest, type ProgressCacheKey } from '../src/cache/progress-cache.ts'
import { zeroUsage } from './helpers.ts'

const roots: string[] = []
const key: ScoreCacheKey = {
  promptVersion: 'v1', backend: 'deepseek', model: 'model', problem: 'secret problem',
  traceA: 'private trace A', traceB: 'private trace B',
  criterion: { id: 'correct', name: 'Correctness', description: 'Be correct' },
  repeat: 0, slotOrder: 'AB',
}

afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })

describe('score cache', () => {
  it('invalidates every scoring identity dimension', () => {
    const original = scoreCacheDigest(key)
    for (const changed of [
      { ...key, model: 'other' },
      { ...key, promptVersion: 'v2' },
      { ...key, problem: 'other' },
      { ...key, traceA: 'other' },
      { ...key, criterion: { ...key.criterion, description: 'other' } },
    ]) expect(scoreCacheDigest(changed)).not.toBe(original)
  })

  it('writes only numeric scores and usage, and treats corruption as a miss', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-verifier-cache-'))
    roots.push(root)
    const cache = new ScoreCache(root)
    await cache.set(key, { scoreA: 1, scoreB: 0, usage: zeroUsage })
    expect(await cache.get(key)).toEqual({ scoreA: 1, scoreB: 0, usage: zeroUsage })
    const raw = await readFile(cache.pathFor(key), 'utf8')
    expect(raw).not.toContain(key.problem)
    expect(raw).not.toContain(key.traceA)
    await writeFile(cache.pathFor(key), '{broken')
    await expect(cache.get(key)).resolves.toBeUndefined()
  })
})

describe('progress cache', () => {
  const progressKey: ProgressCacheKey = {
    promptVersion: 'progress-v1', backend: 'deepseek', model: 'model', problem: 'private problem',
    steps: ['private step'], checkpoints: [1], repeat: 0,
  }

  it('invalidates progress identity and stores no raw trajectory', async () => {
    expect(progressCacheDigest({ ...progressKey, model: 'other' })).not.toBe(progressCacheDigest(progressKey))
    expect(progressCacheDigest({ ...progressKey, checkpoints: [2] })).not.toBe(progressCacheDigest(progressKey))
    const root = await mkdtemp(join(tmpdir(), 'dsh-progress-cache-'))
    roots.push(root)
    const cache = new ProgressCache(root)
    await cache.set(progressKey, { scores: [0.5], usage: zeroUsage })
    expect(await cache.get(progressKey)).toEqual({ scores: [0.5], usage: zeroUsage })
    const raw = await readFile(cache.pathFor(progressKey), 'utf8')
    expect(raw).not.toContain(progressKey.problem)
    expect(raw).not.toContain(progressKey.steps[0] as string)
    await writeFile(cache.pathFor(progressKey), '{broken')
    await expect(cache.get(progressKey)).resolves.toBeUndefined()
  })
})
