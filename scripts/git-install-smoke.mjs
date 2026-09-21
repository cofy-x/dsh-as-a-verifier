import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import {
  argument,
  assertGitHubRepository,
  assertPnpmVersion,
  manifest as expected,
  packageName as PACKAGE_NAME,
  repository as DEFAULT_REPOSITORY,
  root,
} from './project.mjs'

const REPOSITORY = assertGitHubRepository(argument('--repository', { required: false }) ?? DEFAULT_REPOSITORY)

function run(command, args, cwd) {
  const executable = process.platform === 'win32' && command === 'pnpm' ? 'pnpm.cmd' : command
  const result = spawnSync(executable, args, { cwd, encoding: 'utf8', stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`)
}

function capture(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`)
  return result.stdout.trim()
}

const ref = argument('--ref')
const installRefPattern = new RegExp('^(?:[0-9a-f]{40}|v[0-9]+\\.[0-9]+\\.[0-9]+)$')
const exactCommitPattern = new RegExp('^[0-9a-f]{40}$')
if (!installRefPattern.test(ref)) {
  throw new Error('Git-install smoke ref must be an exact commit or release tag')
}
const resolvedCommit = exactCommitPattern.test(ref)
  ? ref
  : capture('git', ['rev-parse', `${ref}^{commit}`], root)
if (!exactCommitPattern.test(resolvedCommit)) throw new Error(`could not resolve ${ref} to an exact commit`)

assertPnpmVersion()
const profilePeers = Object.keys(expected.peerDependencies ?? {}).map((name) => {
  const version = expected.devDependencies?.[name]
  if (typeof version !== 'string') throw new Error(`no audited smoke version is configured for peer ${name}`)
  return `${name}@${version}`
})
const workspace = mkdtempSync(join(tmpdir(), 'dsh-as-a-verifier-git-smoke-'))
try {
  writeFileSync(join(workspace, 'package.json'), JSON.stringify({
    private: true,
    type: 'module',
    packageManager: expected.packageManager,
  }, null, 2))
  writeFileSync(join(workspace, 'pnpm-workspace.yaml'), [
    'packages:',
    "  - '.'",
    'allowBuilds:',
    `  '${PACKAGE_NAME}@https://codeload.github.com/${REPOSITORY}/tar.gz/${resolvedCommit}': true`,
    '',
  ].join('\n'))
  run('pnpm', ['add', '--save-exact', `github:${REPOSITORY}#${ref}`, ...profilePeers], workspace)

  const require = createRequire(join(workspace, 'smoke.cjs'))
  const entry = require.resolve(PACKAGE_NAME)
  const installedRoot = dirname(dirname(entry))
  const manifest = JSON.parse(readFileSync(join(installedRoot, 'package.json'), 'utf8'))
  if (manifest.version !== expected.version) throw new Error(`installed version ${manifest.version} does not match ${expected.version}`)
  if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml' || !existsSync(join(installedRoot, 'cordis.patch.yml'))) {
    throw new Error('installed package omitted its DSH bundle patch')
  }
  const plugin = await import(`${pathToFileURL(entry).href}?smoke=${Date.now()}`)
  for (const name of ['name', 'inject', 'Config', 'apply']) {
    if (!(name in plugin)) throw new Error(`installed package omitted export ${name}`)
  }
  if ('default' in plugin) throw new Error('installed package unexpectedly has a default export')
  if (plugin.VERIFIER_PROTOCOL_VERSION !== 1) throw new Error('installed provider does not publish verifier protocol 1')
  for (const capability of ['pairwiseComparison', 'candidateSelection', 'offlineProgressTracking', 'onlineProgressTracking']) {
    if (plugin.VERIFIER_CAPABILITIES?.[capability] !== true) throw new Error(`installed provider omitted capability ${capability}`)
  }
  console.log(`${PACKAGE_NAME} Git-install smoke passed for ${ref}`)
} finally {
  rmSync(workspace, { recursive: true, force: true })
}
