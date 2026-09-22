/** Pure offline metrics for labeled verifier experiment results. */

export interface BenchmarkDecision {
  readonly score?: number
  readonly completed?: boolean
  readonly latencyMs?: number
  readonly errorCode?: string
}

export interface BenchmarkResultRow {
  readonly id: string
  readonly label: boolean
  readonly language?: string
  readonly outcome?: string
  readonly existing: BenchmarkDecision
  readonly jev: BenchmarkDecision
}

export interface BenchmarkMetrics {
  readonly total: number
  readonly evaluated: number
  readonly errors: number
  readonly accuracy: number | null
  readonly precision: number | null
  readonly recall: number | null
  readonly falsePositiveRate: number | null
  readonly falseNegativeRate: number | null
  readonly disagreementRate: number | null
  readonly latencyP50Ms: number | null
  readonly latencyP95Ms: number | null
  readonly errorRate: number
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator
}

function percentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.ceil(fraction * sorted.length) - 1] as number
}

export function benchmarkMetrics(rows: readonly BenchmarkResultRow[], provider: 'existing' | 'jev'): BenchmarkMetrics {
  let tp = 0
  let tn = 0
  let fp = 0
  let fn = 0
  let errors = 0
  let disagreements = 0
  let comparable = 0
  const latencies: number[] = []
  for (const row of rows) {
    const decision = row[provider]
    if (typeof decision.latencyMs === 'number' && Number.isFinite(decision.latencyMs) && decision.latencyMs >= 0) latencies.push(decision.latencyMs)
    if (decision.errorCode !== undefined || decision.completed === undefined) {
      errors += 1
      continue
    }
    if (decision.completed && row.label) tp += 1
    else if (decision.completed) fp += 1
    else if (row.label) fn += 1
    else tn += 1
    const other = row[provider === 'existing' ? 'jev' : 'existing']
    if (other.completed !== undefined && other.errorCode === undefined) {
      comparable += 1
      if (other.completed !== decision.completed) disagreements += 1
    }
  }
  const evaluated = tp + tn + fp + fn
  return {
    total: rows.length,
    evaluated,
    errors,
    accuracy: ratio(tp + tn, evaluated),
    precision: ratio(tp, tp + fp),
    recall: ratio(tp, tp + fn),
    falsePositiveRate: ratio(fp, fp + tn),
    falseNegativeRate: ratio(fn, fn + tp),
    disagreementRate: ratio(disagreements, comparable),
    latencyP50Ms: percentile(latencies, 0.5),
    latencyP95Ms: percentile(latencies, 0.95),
    errorRate: rows.length === 0 ? 0 : errors / rows.length,
  }
}

export function groupedBenchmarkMetrics(rows: readonly BenchmarkResultRow[]): Record<string, { existing: BenchmarkMetrics, jev: BenchmarkMetrics }> {
  const groups = new Map<string, BenchmarkResultRow[]>([['all', [...rows]]])
  for (const row of rows) {
    for (const [dimension, value] of [['language', row.language], ['outcome', row.outcome]] as const) {
      if (value === undefined || value.length === 0) continue
      const key = `${dimension}:${value}`
      const group = groups.get(key) ?? []
      group.push(row)
      groups.set(key, group)
    }
  }
  return Object.fromEntries([...groups].map(([key, group]) => [key, {
    existing: benchmarkMetrics(group, 'existing'),
    jev: benchmarkMetrics(group, 'jev'),
  }]))
}
