import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const EXPECTED_COMMIT = 'cd5ef8148158c3a752a658978873241fdf8e2bbc'
const EXPECTED_VERSION = '0.1.2-alpha.1'
const source = process.env.DSH_SOURCE_DIR
if (!source) throw new Error('DSH_SOURCE_DIR must point to the checked-out deepseek-harness release')

async function text(path) {
  return readFile(resolve(source, path), 'utf8')
}

const root = JSON.parse(await text('package.json'))
assert.equal(root.version, EXPECTED_VERSION, 'unexpected deepseek-harness release version')
assert.equal(root.packageManager, 'pnpm@11.7.0', 'unexpected deepseek-harness pnpm baseline')
assert.equal(root.engines?.node, '^22.19.0 || >=24.0.0', 'unexpected deepseek-harness Node baseline')

const tools = await text('packages/core/tools/src/index.ts')
assert.match(tools, /export \{\s*defineTool,/s, 'dsh-tools no longer exports defineTool')

const credentials = await text('packages/credentials/credentials/src/index.ts')
assert.match(credentials, /export function credentialRef\(/, 'dsh-credentials no longer exports credentialRef')

const homePaths = await text('packages/util/home-paths/src/index.ts')
assert.match(homePaths, /export function resolveDshHome\(/, 'dsh-home-paths no longer exports resolveDshHome')

const launchEnvironment = await text('packages/util/launch-environment/src/index.ts')
assert.match(launchEnvironment, /export function launchEnvironmentOf\(/, 'dsh-launch-environment no longer exports launchEnvironmentOf')

const atomicWrite = await text('packages/util/atomic-write/src/index.ts')
assert.match(atomicWrite, /export async function writeFileAtomic\(/, 'dsh-atomic-write no longer exports writeFileAtomic')

const gitHead = process.env.DSH_SOURCE_COMMIT
if (gitHead !== undefined) assert.equal(gitHead, EXPECTED_COMMIT, 'compatibility checkout is not the audited DSH release commit')

