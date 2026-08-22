/**
 * Probabilistic Pivot Tournament derived from llm-as-a-verifier at commit
 * 8db8a114355a9d7fdf9a8d1d5c87f6aeebd18770 (MIT).
 * @module dsh-as-a-verifier/tournament/ppt
 */

export type DirectedPair = readonly [number, number]

/** Stable seeded PRNG used only to construct the tournament ring. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state += 0x6d2b79f5
    let value = state
    value = Math.imul(value ^ value >>> 15, value | 1)
    value ^= value + Math.imul(value ^ value >>> 7, value | 61)
    return ((value ^ value >>> 14) >>> 0) / 4_294_967_296
  }
}

/** Construct a random Hamiltonian cycle with every candidate once in each slot. */
export function ringCycle(count: number, seed: number): DirectedPair[] {
  if (count <= 1) return []
  const random = seededRandom(seed)
  const order = Array.from({ length: count }, (_, index) => index)
  for (let index = order.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1))
    ;[order[index], order[other]] = [order[other] as number, order[index] as number]
  }
  return order.map((candidate, index) => [candidate, order[(index + 1) % order.length] as number] as const)
}

/** Convert a pair of rewards into soft win probability. */
export function bradleyTerry(rewardA: number, rewardB: number): number {
  return 1 / (1 + Math.exp(-(rewardA - rewardB)))
}

/** Select the empirical leaders after the ring pass. */
export function selectPivots(winMass: readonly number[], counts: readonly number[], pivots: number): number[] {
  return Array.from({ length: winMass.length }, (_, index) => index)
    .sort((left, right) => {
      const leftScore = counts[left] === 0 ? 0 : (winMass[left] as number) / (counts[left] as number)
      const rightScore = counts[right] === 0 ? 0 : (winMass[right] as number) / (counts[right] as number)
      return rightScore - leftScore || left - right
    })
    .slice(0, Math.min(pivots, winMass.length))
}

/** Build non-pivot-vs-pivot and pivot-vs-pivot directed rounds. */
export function pivotRoundPairs(count: number, pivots: readonly number[]): DirectedPair[] {
  const pivotSet = new Set(pivots)
  const pairs: DirectedPair[] = []
  for (let candidate = 0; candidate < count; candidate += 1) {
    if (pivotSet.has(candidate)) continue
    for (const pivot of pivots) pairs.push([candidate, pivot])
  }
  const sorted = [...pivots].sort((left, right) => left - right)
  for (let left = 0; left < sorted.length; left += 1) {
    for (let right = left + 1; right < sorted.length; right += 1) {
      pairs.push([sorted[left] as number, sorted[right] as number])
    }
  }
  return pairs
}

/** Expected number of directed comparisons for the complete tournament. */
export function comparisonCount(count: number, pivots: number): number {
  const clamped = Math.min(count, pivots)
  return count <= 1 ? 0 : count + clamped * (count - clamped) + clamped * (clamped - 1) / 2
}
