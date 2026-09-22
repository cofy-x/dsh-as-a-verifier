import { describe, expect, it } from 'vitest'
import { benchmarkMetrics, groupedBenchmarkMetrics } from '../src/benchmark/metrics.ts'

const rows = [
  { id: 'tp', label: true, language: 'en', outcome: 'success', existing: { completed: true, latencyMs: 10 }, jev: { completed: true, latencyMs: 2 } },
  { id: 'fp', label: false, language: 'en', outcome: 'failure', existing: { completed: false, latencyMs: 20 }, jev: { completed: true, latencyMs: 4 } },
  { id: 'fn', label: true, language: 'zh', outcome: 'failure', existing: { completed: true, latencyMs: 30 }, jev: { completed: false, latencyMs: 6 } },
  { id: 'error', label: false, language: 'zh', outcome: 'failure', existing: { completed: false, latencyMs: 40 }, jev: { errorCode: 'TIMEOUT', latencyMs: 8 } },
]

describe('Jev benchmark metrics', () => {
  it('computes confusion, disagreement, latency, and error metrics', () => {
    expect(benchmarkMetrics(rows, 'jev')).toEqual({
      total: 4, evaluated: 3, errors: 1, accuracy: 1 / 3, precision: 0.5, recall: 0.5,
      falsePositiveRate: 1, falseNegativeRate: 0.5, disagreementRate: 2 / 3,
      latencyP50Ms: 4, latencyP95Ms: 8, errorRate: 0.25,
    })
  })

  it('groups by language and outcome without inventing missing dimensions', () => {
    const groups = groupedBenchmarkMetrics(rows)
    expect(Object.keys(groups).sort()).toEqual(['all', 'language:en', 'language:zh', 'outcome:failure', 'outcome:success'])
    expect(groups['language:zh']?.jev.total).toBe(2)
  })
})
