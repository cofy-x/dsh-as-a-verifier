/** Privacy-minimal content-addressed progress cache. @module dsh-as-a-verifier/cache/progress-cache */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { VerifierUsage } from '../types.ts'

const CACHE_VERSION = 1

export interface ProgressCacheKey {
  readonly promptVersion: string
  readonly backend: string
  readonly model: string
  readonly problem: string
  readonly steps: readonly string[]
  readonly checkpoints: readonly number[]
  readonly repeat: number
}

export interface CachedProgress {
  readonly scores: readonly number[]
  readonly usage: VerifierUsage
}

function valid(value: unknown): value is CachedProgress {
  if (value === null || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  if (!Array.isArray(entry.scores) || entry.scores.some(score => typeof score !== 'number' || !Number.isFinite(score) || score < 0 || score > 1)) return false
  if (entry.usage === null || typeof entry.usage !== 'object') return false
  const usage = entry.usage as Record<string, unknown>
  return ['calls', 'inputTokens', 'cachedInputTokens', 'uncachedInputTokens', 'outputTokens', 'reasoningTokens']
    .every(key => typeof usage[key] === 'number' && Number.isSafeInteger(usage[key]) && (usage[key] as number) >= 0)
    && typeof usage.cacheHitRate === 'number' && Number.isFinite(usage.cacheHitRate)
    && usage.cacheHitRate >= 0 && usage.cacheHitRate <= 1
}

export function progressCacheDigest(key: ProgressCacheKey): string {
  return createHash('sha256').update(JSON.stringify(key)).digest('hex')
}

export class ProgressCache {
  constructor(private readonly dataDir: string, private readonly enabled = true) {}

  pathFor(key: ProgressCacheKey): string {
    const digest = progressCacheDigest(key)
    return join(this.dataDir, 'progress-cache', `v${CACHE_VERSION}`, digest.slice(0, 2), `${digest}.json`)
  }

  async get(key: ProgressCacheKey): Promise<CachedProgress | undefined> {
    if (!this.enabled) return undefined
    try {
      const parsed = JSON.parse(await readFile(this.pathFor(key), 'utf8')) as Record<string, unknown>
      if (parsed.version !== CACHE_VERSION || !valid(parsed)) return undefined
      return { scores: parsed.scores as number[], usage: parsed.usage as VerifierUsage }
    } catch {
      return undefined
    }
  }

  async set(key: ProgressCacheKey, entry: CachedProgress): Promise<void> {
    if (!this.enabled) return
    await writeFileAtomic(this.pathFor(key), `${JSON.stringify({ version: CACHE_VERSION, ...entry })}\n`, {
      mode: 0o600,
      dirMode: 0o700,
    })
  }
}
