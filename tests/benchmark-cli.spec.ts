import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('benchmark CLI', () => {
  it.skipIf(Number(process.versions.node.split('.')[0]) < 24)('settles real SDK partial-body cancellation in an isolated Node process', () => {
    const result = execFileSync(process.execPath, ['tests/fixtures/jev-sdk-cancel.mjs'], {
      encoding: 'utf8', timeout: 5000,
      env: { ...process.env, DEEPSEEK_API_KEY: '', TYPESAFE_API_KEY: '' },
    })
    expect(result).toContain('real SDK cancellation and timeout settled')
  })
  it('rejects empty datasets before any credentials or network are needed', () => {
    const root = mkdtempSync(join(tmpdir(), 'jev-cli-'))
    try {
      const input = join(root, 'empty.jsonl')
      writeFileSync(input, '')
      expect(() => execFileSync(process.execPath, ['scripts/jev-benchmark.mjs', 'dry-run', '--input', input], { stdio: 'pipe' })).toThrow()
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it('validates fixtures without loading SDK credentials and rejects tuning on a test split', () => {
    const env = { ...process.env, DEEPSEEK_API_KEY: '', TYPESAFE_API_KEY: '' }
    const result = execFileSync(process.execPath, ['scripts/jev-benchmark.mjs', 'dry-run', '--input', 'benchmarks/fixtures/jev-synthetic.jsonl'], { env, encoding: 'utf8' })
    expect(JSON.parse(result).cases).toBe(4)
    expect(() => execFileSync(process.execPath, ['scripts/jev-benchmark.mjs', 'replay', '--input', 'not-read.jsonl', '--split', 'test'], { env, stdio: 'pipe' })).toThrow()
  })
})
