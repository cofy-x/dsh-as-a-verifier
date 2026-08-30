import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import semver from 'semver'

const CURRENT_DSH_RELEASE = '0.1.2-alpha.1'
const PUBLISHED_DSH_BASELINE = '0.1.1-rc.2'
const DSH_PEERS = [
  '@deepseek-ai/dsh-atomic-write',
  '@deepseek-ai/dsh-credentials',
  '@deepseek-ai/dsh-home-paths',
  '@deepseek-ai/dsh-launch-environment',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-tools',
]

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
for (const name of DSH_PEERS) {
  const range = pkg.peerDependencies?.[name]
  assert.equal(typeof range, 'string', `missing peer dependency ${name}`)
  assert.equal(semver.satisfies(PUBLISHED_DSH_BASELINE, range), true, `${name} must accept the published test baseline`)
  assert.equal(semver.satisfies(CURRENT_DSH_RELEASE, range), true, `${name} must accept the current DSH release`)
  assert.equal(semver.satisfies('0.2.0', range), false, `${name} must not silently accept the next minor contract`)
}

assert.equal(semver.satisfies('22.19.0', pkg.engines.node), true, 'Node 22.19.0 must remain the minimum compatibility target')
assert.equal(semver.satisfies('24.0.0', pkg.engines.node), true, 'Node 24 must be supported')
assert.equal(semver.satisfies('22.18.0', pkg.engines.node), false, 'Node releases below 22.19.0 must be rejected')

