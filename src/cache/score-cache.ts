/** Content-addressed score cache with privacy-minimal entries. @module dsh-as-a-verifier/cache/score-cache */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { VerifierUsage } from '../types.ts'

const CACHE_VERSION = 2

export interface ScoreCacheKey {
  readonly promptVersion: string
  readonly backend: string
  readonly model: string
  readonly problem: string
  readonly traceA: string
  readonly traceB: string
  readonly criterion: { readonly id: string, readonly name: string, readonly description: string }
  readonly repeat: number
  readonly slotOrder: 'AB' | 'BA'
}

export interface CachedScore {
  readonly scoreA: number
  readonly scoreB: number
  readonly usage: VerifierUsage
}

function validScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function validUsage(value: unknown): value is VerifierUsage {
  if (value === null || typeof value !== 'object') return false
  const usage = value as Record<string, unknown>
  const naturals = ['calls', 'inputTokens', 'cachedInputTokens', 'uncachedInputTokens', 'outputTokens', 'reasoningTokens']
  return naturals.every(key => typeof usage[key] === 'number' && Number.isSafeInteger(usage[key]) && (usage[key] as number) >= 0)
    && typeof usage.cacheHitRate === 'number' && Number.isFinite(usage.cacheHitRate)
    && usage.cacheHitRate >= 0 && usage.cacheHitRate <= 1
    && (usage.cachedInputTokens as number) <= (usage.inputTokens as number)
    && (usage.uncachedInputTokens as number) === (usage.inputTokens as number) - (usage.cachedInputTokens as number)
}

/** Stable SHA-256 digest over the complete scoring identity. */
export function scoreCacheDigest(key: ScoreCacheKey): string {
  return createHash('sha256').update(JSON.stringify(key)).digest('hex')
}

/** Cache entries contain only numeric score and usage data; raw prompts never enter the file. */
export class ScoreCache {
  constructor(private readonly dataDir: string, private readonly enabled = true) {}

  pathFor(key: ScoreCacheKey): string {
    const digest = scoreCacheDigest(key)
    return join(this.dataDir, 'cache', `v${CACHE_VERSION}`, digest.slice(0, 2), `${digest}.json`)
  }

  async get(key: ScoreCacheKey): Promise<CachedScore | undefined> {
    if (!this.enabled) return undefined
    try {
      const parsed = JSON.parse(await readFile(this.pathFor(key), 'utf8')) as Record<string, unknown>
      if (parsed.version !== CACHE_VERSION || !validScore(parsed.scoreA) || !validScore(parsed.scoreB) || !validUsage(parsed.usage)) return undefined
      return { scoreA: parsed.scoreA, scoreB: parsed.scoreB, usage: parsed.usage }
    } catch {
      return undefined
    }
  }

  async set(key: ScoreCacheKey, score: CachedScore): Promise<void> {
    if (!this.enabled) return
    await writeFileAtomic(this.pathFor(key), `${JSON.stringify({
      version: CACHE_VERSION,
      scoreA: score.scoreA,
      scoreB: score.scoreB,
      usage: score.usage,
    })}\n`, { mode: 0o600, dirMode: 0o700 })
  }
}
