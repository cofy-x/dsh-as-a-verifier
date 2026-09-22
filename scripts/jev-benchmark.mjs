#!/usr/bin/env node

import { mkdir, readFile, open } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import process from 'node:process'

function usage() {
  console.error('Usage: node scripts/jev-benchmark.mjs <dry-run|run|summarize|replay> --input <jsonl> [--output <new-jsonl>] [--existing-threshold <0..1>] [--jev-threshold <0..1>] [--split calibration|test]')
}

function parseArgs(argv) {
  const [command, ...rest] = argv
  const options = { command, existingThreshold: 0.85, jevThreshold: 0.95 }
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index]
    const value = rest[index + 1]
    if (value === undefined) throw new Error(`missing value for ${key}`)
    if (key === '--input') options.input = value
    else if (key === '--output') options.output = value
    else if (key === '--existing-threshold') options.existingThreshold = Number(value)
    else if (key === '--jev-threshold') options.jevThreshold = Number(value)
    else if (key === '--split') options.split = value
    else throw new Error(`unknown option: ${key}`)
  }
  if (!['dry-run', 'run', 'summarize', 'replay'].includes(command) || options.input === undefined) throw new Error('invalid command or missing --input')
  if (options.split !== undefined && !['calibration', 'test'].includes(options.split)) throw new Error('invalid split')
  if (command === 'replay' && options.split === 'test') throw new Error('threshold exploration is restricted to calibration data')
  for (const [key, value] of [['existing threshold', options.existingThreshold], ['Jev threshold', options.jevThreshold]]) {
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`${key} must be within 0..1`)
  }
  if (command === 'run' && options.output === undefined) throw new Error('run requires --output')
  return options
}

function object(value, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`)
  return value
}

async function readJsonl(path) {
  const text = await readFile(resolve(path), 'utf8')
  return text.split('\n').map(line => line.endsWith('\r') ? line.slice(0, -1) : line).filter(line => line.trim().length > 0).map((line, index) => {
    try { return JSON.parse(line) } catch { throw new Error(`invalid JSON on line ${index + 1}`) }
  })
}

function validateDataset(rawRows) {
  if (rawRows.length === 0) throw new Error('dataset must not be empty')
  const ids = new Set()
  return rawRows.map((raw, index) => {
    const row = object(raw, `line ${index + 1}`)
    if (typeof row.id !== 'string' || row.id.trim().length === 0 || ids.has(row.id)) throw new Error(`line ${index + 1} has an invalid or duplicate id`)
    ids.add(row.id)
    if (typeof row.problem !== 'string' || row.problem.trim().length === 0) throw new Error(`line ${index + 1} has an invalid problem`)
    if (!Array.isArray(row.steps) || row.steps.length === 0 || row.steps.some(step => typeof step !== 'string' || step.trim().length === 0)) throw new Error(`line ${index + 1} has invalid steps`)
    if (typeof row.label !== 'boolean') throw new Error(`line ${index + 1} has an invalid label`)
    for (const key of ['language', 'outcome']) if (row[key] !== undefined && typeof row[key] !== 'string') throw new Error(`line ${index + 1} has an invalid ${key}`)
    if (row.split !== undefined && !['calibration', 'test'].includes(row.split)) throw new Error(`line ${index + 1} has an invalid split`)
    return { id: row.id, problem: row.problem, steps: row.steps, label: row.label, language: row.language, outcome: row.outcome, split: row.split }
  })
}

function validateResults(rawRows) {
  const ids = new Set()
  const validateEvaluation = (value, label) => {
    const evaluation = object(value, label)
    if (evaluation.errorCode !== undefined) {
      if (typeof evaluation.errorCode !== 'string' || evaluation.errorCode.length === 0) throw new Error(`${label} has an invalid errorCode`)
    } else if (typeof evaluation.score !== 'number' || !Number.isFinite(evaluation.score) || evaluation.score < 0 || evaluation.score > 1 || typeof evaluation.completed !== 'boolean') {
      throw new Error(`${label} has an invalid score or decision`)
    }
    if (typeof evaluation.latencyMs !== 'number' || !Number.isFinite(evaluation.latencyMs) || evaluation.latencyMs < 0) throw new Error(`${label} has an invalid latency`)
    return evaluation
  }
  return rawRows.map((raw, index) => {
    const row = object(raw, `line ${index + 1}`)
    if (typeof row.id !== 'string' || !row.id.trim() || ids.has(row.id) || typeof row.label !== 'boolean') throw new Error(`line ${index + 1} has invalid or duplicate identity`)
    ids.add(row.id)
    if (row.split !== undefined && !['calibration', 'test'].includes(row.split)) throw new Error(`line ${index + 1} has invalid split`)
    for (const key of ['language', 'outcome']) if (row[key] !== undefined && typeof row[key] !== 'string') throw new Error(`line ${index + 1} has invalid ${key}`)
    return {
      ...row,
      existing: validateEvaluation(row.existing, `line ${index + 1} existing`),
      jev: validateEvaluation(row.jev, `line ${index + 1} jev`),
    }
  })
}

async function loadLibrary() {
  try { return await import('../lib/index.js') } catch {
    throw new Error('built package is missing; run `pnpm run prepare` first')
  }
}

async function main() {
  let options
  try { options = parseArgs(process.argv.slice(2)) } catch (error) {
    usage()
    throw error
  }
  if (options.command === 'summarize' || options.command === 'replay') {
    const lib = await loadLibrary()
    let rows = validateResults(await readJsonl(options.input))
    if (options.split) rows = rows.filter(row => row.split === options.split)
    if (options.command === 'replay') {
      rows = rows.filter(row => row.split === 'calibration')
      if (rows.length === 0) throw new Error('replay requires explicitly labeled calibration rows')
      const replay = rows.map(row => ({ ...row,
        existing: { ...row.existing, completed: row.existing.errorCode ? undefined : row.existing.score >= options.existingThreshold },
        jev: { ...row.jev, completed: row.jev.errorCode ? undefined : row.jev.score >= options.jevThreshold },
      }))
      console.log(JSON.stringify({ thresholds: { existing: options.existingThreshold, jev: options.jevThreshold }, metrics: lib.groupedBenchmarkMetrics(replay) }, null, 2))
    } else {
      if (!rows.length) throw new Error('no result rows selected')
      console.log(JSON.stringify(lib.groupedBenchmarkMetrics(rows), null, 2))
    }
    return
  }
  const dataset = validateDataset(await readJsonl(options.input))
  if (options.split && dataset.some(row => row.split !== options.split)) throw new Error('input dataset does not match requested split')
  if (options.command === 'dry-run') {
    console.log(JSON.stringify({ valid: true, cases: dataset.length, languages: [...new Set(dataset.map(row => row.language).filter(Boolean))] }, null, 2))
    return
  }
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('live Jev benchmark requires Node.js 24 or newer')
  const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim()
  const typesafeKey = process.env.TYPESAFE_API_KEY?.trim()
  if (!deepseekKey || !typesafeKey) throw new Error('run requires DEEPSEEK_API_KEY and TYPESAFE_API_KEY')
  const lib = await loadLibrary()
  const root = fileURLToPath(new URL('..', import.meta.url))
  const git = args => { try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() } catch { return null } }
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  const digest = value => createHash('sha256').update(value).digest('hex')
  const provenance = {
    schema: 'jev-benchmark-v2', startedAt: new Date().toISOString(),
    thresholds: { existing: options.existingThreshold, jev: options.jevThreshold },
    commit: git(['rev-parse', 'HEAD']), dirty: Boolean(git(['status', '--porcelain'])),
    builtSha256: digest(await readFile(new URL('../lib/index.js', import.meta.url))),
    runnerSha256: digest(await readFile(fileURLToPath(import.meta.url))),
    datasetSha256: digest(await readFile(resolve(options.input))),
    sdk: manifest.dependencies['@typesafe-ai/sdk'], node: process.version,
    jevSchema: lib.JEV_PROGRESS_SCHEMA_VERSION,
  }
  const common = { cacheEnabled: false, nEvaluations: 1, maxEvaluations: 1, jevCompletionThreshold: options.jevThreshold }
  const existingConfig = lib.resolveConfig({ ...common, progressEvaluatorMode: 'existing' })
  const jevConfig = lib.resolveConfig({ ...common, progressEvaluatorMode: 'jev' })
  const existingBackend = new lib.DeepSeekBackend({ config: existingConfig, resolveApiKey: async () => deepseekKey })
  const jevBackend = new lib.DeepSeekBackend({ config: jevConfig, resolveApiKey: async () => deepseekKey })
  const existing = new lib.VerifierService(existingConfig, existingBackend, new lib.ScoreCache(existingConfig.dataDir, false), new lib.ProgressCache(existingConfig.dataDir, false))
  const jevEvaluator = new lib.JevProgressEvaluator(jevConfig, async () => typesafeKey, new lib.JevProgressCache(jevConfig.dataDir, false))
  const jev = new lib.VerifierService(jevConfig, jevBackend, new lib.ScoreCache(jevConfig.dataDir, false), new lib.ProgressCache(jevConfig.dataDir, false), jevEvaluator)
  const output = resolve(options.output)
  await mkdir(dirname(output), { recursive: true, mode: 0o700 })
  // Reserve before any paid call; never overwrite an earlier experiment.
  const outputFile = await open(output, 'wx', 0o600)
  const results = []
  try {
    for (const row of dataset) {
      const evaluate = async (service, threshold) => {
        const started = performance.now()
        try {
          const result = await service.track({ problem: row.problem, steps: row.steps, checkpointSteps: [row.steps.length], nEvaluations: 1 })
          return { score: result.final, threshold, completed: result.final >= threshold, latencyMs: performance.now() - started, usage: result.usage }
        } catch (error) {
          return { latencyMs: performance.now() - started, errorCode: typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'UNKNOWN' }
        }
      }
      const resultRow = {
        provenance,
        models: { existing: existingConfig.model, jev: jevConfig.jevModel },
        id: row.id, label: row.label, language: row.language, outcome: row.outcome, split: row.split,
        existing: await evaluate(existing, options.existingThreshold),
        jev: await evaluate(jev, options.jevThreshold),
      }
      results.push(resultRow)
      await outputFile.write(`${JSON.stringify(resultRow)}\n`)
      await outputFile.sync()
    }
  } finally {
    await Promise.allSettled([existing.dispose(), jev.dispose()])
    await outputFile.close()
  }
  console.log(JSON.stringify({ output, metrics: lib.groupedBenchmarkMetrics(results), costNote: 'Jev USD cost can be estimated from recorded input tokens and the current pinned-model price; verify pricing before reporting.' }, null, 2))
}

await main()
