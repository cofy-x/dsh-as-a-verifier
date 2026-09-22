/** Privacy-minimal raw Jev completion-probability cache. */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { VerifierUsage } from '../types.ts'

const CACHE_VERSION = 1

export interface JevProgressCacheKey {
  readonly schemaVersion: string
  readonly provider: string
  readonly model: string
  readonly problem: string
  readonly result: string
  readonly repeat: number
}

export interface CachedJevProgress {
  readonly probability: number
  readonly model: string
  readonly usage: VerifierUsage
}

function natural(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function valid(value: unknown): value is CachedJevProgress {
  if (value === null || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  if (typeof entry.probability !== 'number' || !Number.isFinite(entry.probability) || entry.probability < 0 || entry.probability > 1) return false
  if (typeof entry.model !== 'string' || entry.model.length === 0) return false
  if (entry.usage === null || typeof entry.usage !== 'object') return false
  const usage = entry.usage as Record<string, unknown>
  return ['calls', 'inputTokens', 'cachedInputTokens', 'uncachedInputTokens', 'outputTokens', 'reasoningTokens'].every(key => natural(usage[key]))
    && typeof usage.cacheHitRate === 'number' && usage.cacheHitRate >= 0 && usage.cacheHitRate <= 1
}

export function jevProgressCacheDigest(key: JevProgressCacheKey): string {
  return createHash('sha256').update(JSON.stringify(key)).digest('hex')
}

export class JevProgressCache {
  constructor(private readonly dataDir: string, private readonly enabled = true) {}

  pathFor(key: JevProgressCacheKey): string {
    const digest = jevProgressCacheDigest(key)
    return join(this.dataDir, 'jev-progress-cache', `v${CACHE_VERSION}`, digest.slice(0, 2), `${digest}.json`)
  }

  async get(key: JevProgressCacheKey): Promise<CachedJevProgress | undefined> {
    if (!this.enabled) return undefined
    try {
      const parsed = JSON.parse(await readFile(this.pathFor(key), 'utf8')) as Record<string, unknown>
      if (parsed.version !== CACHE_VERSION || !valid(parsed)) return undefined
      return { probability: parsed.probability, model: parsed.model, usage: parsed.usage }
    } catch {
      return undefined
    }
  }

  async set(key: JevProgressCacheKey, entry: CachedJevProgress): Promise<void> {
    if (!this.enabled) return
    await writeFileAtomic(this.pathFor(key), `${JSON.stringify({ version: CACHE_VERSION, ...entry })}\n`, {
      mode: 0o600,
      dirMode: 0o700,
    })
  }
}
