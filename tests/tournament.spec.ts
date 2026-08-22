import { describe, expect, it } from 'vitest'
import { comparisonCount, pivotRoundPairs, ringCycle, selectPivots } from '../src/tournament/ppt.ts'

describe('Probabilistic Pivot Tournament', () => {
  it('builds a stable seeded directed ring', () => {
    expect(ringCycle(6, 42)).toEqual(ringCycle(6, 42))
    expect(ringCycle(6, 42)).not.toEqual(ringCycle(6, 43))
    const ring = ringCycle(6, 42)
    expect(new Set(ring.map(([left]) => left)).size).toBe(6)
    expect(new Set(ring.map(([, right]) => right)).size).toBe(6)
  })

  it('uses the documented comparison budget', () => {
    expect(comparisonCount(5, 2)).toBe(12)
    expect(pivotRoundPairs(5, [1, 3])).toHaveLength(7)
  })

  it('breaks pivot ties by candidate index', () => {
    expect(selectPivots([1, 1, 1], [2, 2, 2], 2)).toEqual([0, 1])
  })
})
